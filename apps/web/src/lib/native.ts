import { mapRpc } from './rpc-batch.ts';
import { formatUnits, type Address, type PublicClient } from 'viem';
import type { Balance, Market, Position, RiskMetrics } from './domain.ts';
import { erc20Abi, v3OracleAbi, v3PoolAbi, v3ProviderAbi, v4HubAbi, v4SpokeAbi } from './abis.ts';
import type { MarketDiscovery } from './discovery.ts';

const WAD = 10n ** 18n;
function decimal(value: bigint, decimals = 18): string { return formatUnits(value, decimals); }
function actualLtv(collateral: bigint, debt: bigint): string | null { return collateral === 0n ? null : decimal(debt * (10n ** 18n) / collateral); }
function risk(values: { healthFactor: bigint; ltv: string | null; collateral: string | null; debt: string | null; capacity: string | null; riskPremium?: bigint }): RiskMetrics {
  return { healthFactor: values.debt === '0' ? null : decimal(values.healthFactor), ltv: values.ltv, borrowCapacityUsd: values.capacity, collateralUsd: values.collateral, debtUsd: values.debt, ...(values.riskPremium === undefined ? {} : { riskPremiumBps: values.riskPremium.toString() }) };
}

function baseValue(value: bigint, baseCurrency: Address, baseUnit: bigint): string | null {
  // Aave V3 uses address(0) to denote an USD base currency. If a deployment
  // uses a token-denominated base currency, do not label the raw value USD.
  return baseCurrency.toLowerCase() === '0x0000000000000000000000000000000000000000' ? decimal(value, baseUnit.toString().length - 1) : null;
}

/** V3 active configuration plus account actions includes disabled supplies without scanning every reserve. */
export async function positionReserveTokens(client: PublicClient, market: Pick<Market, 'version' | 'venue'>, account: Address, actionTokens: readonly Address[], blockNumber: bigint): Promise<Address[] | undefined> {
  // V4 keeps a complete inventory until its account-level reserve enumeration is available.
  if (market.version !== 3) return undefined;
  const tokens = new Set(actionTokens.map(token => token.toLowerCase() as Address).filter(token => !/^0x0{40}$/.test(token)));
  const config = await client.readContract({ address: market.venue, abi: v3PoolAbi, functionName: 'getUserConfiguration', args: [account], blockNumber });
  const active = Array.from({ length: 128 }, (_, id) => id).filter(id => ((BigInt(config) >> BigInt(id * 2)) & 3n) !== 0n);
  const addresses = await mapRpc(active, id => client.readContract({ address: market.venue, abi: v3PoolAbi, functionName: 'getReserveAddressById', args: [id], blockNumber }));
  for (const address of addresses) if (!/^0x0{40}$/i.test(address)) tokens.add(address.toLowerCase() as Address);
  return tokens.size ? [...tokens] : undefined;
}

export async function readNativePosition(client: PublicClient, detail: MarketDiscovery, account: Address, owner: Address, salt: `0x${string}`, blockNumber?: bigint): Promise<Pick<Position, 'collaterals' | 'debts' | 'risk' | 'status' | 'freshness'>> {
  if (detail.market.status !== 'available') throw new Error(detail.market.reason ?? 'Market unavailable.');
  const block = blockNumber ?? await client.getBlockNumber();
  const collaterals: Balance[] = [];
  const debts: Balance[] = [];
  if (detail.market.version === 3) {
    const [accountData, userConfig, provider,] = await Promise.all([
      client.readContract({ address: detail.market.venue, abi: v3PoolAbi, functionName: 'getUserAccountData', args: [account], blockNumber: block }),
      client.readContract({ address: detail.market.venue, abi: v3PoolAbi, functionName: 'getUserConfiguration', args: [account], blockNumber: block }),
      client.readContract({ address: detail.market.venue, abi: v3PoolAbi, functionName: 'ADDRESSES_PROVIDER', blockNumber: block }),
    ]);
    const oracle = await client.readContract({ address: provider, abi: v3ProviderAbi, functionName: 'getPriceOracle', blockNumber: block });
    const [baseCurrency, baseUnit] = await Promise.all([
      client.readContract({ address: oracle, abi: v3OracleAbi, functionName: 'BASE_CURRENCY', blockNumber: block }),
      client.readContract({ address: oracle, abi: v3OracleAbi, functionName: 'BASE_CURRENCY_UNIT', blockNumber: block }),
    ]);
    await mapRpc(detail.reserves, async (reserve) => {
      const reserveData = await client.readContract({ address: detail.market.venue, abi: v3PoolAbi, functionName: 'getReserveData', args: [reserve.asset.address], blockNumber: block });
      const aTokenAddress = reserveData[8] as Address;
      const stableDebtTokenAddress = reserveData[9] as Address;
      const variableDebtTokenAddress = reserveData[10] as Address;
      const reserveIndex = Number(reserveData[7]);
      const borrowing = ((BigInt(userConfig) >> BigInt(reserveIndex * 2)) & 1n) === 1n;
      const [supplied, variableDebt, stableDebt] = await Promise.all([
        client.readContract({ address: aTokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account], blockNumber: block }),
        !borrowing ? Promise.resolve(0n) : client.readContract({ address: variableDebtTokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account], blockNumber: block }),
        !borrowing || stableDebtTokenAddress.toLowerCase() === '0x0000000000000000000000000000000000000000' ? Promise.resolve(0n) : client.readContract({ address: stableDebtTokenAddress, abi: erc20Abi, functionName: 'balanceOf', args: [account], blockNumber: block }),
      ]);
      const collateralEnabled = ((BigInt(userConfig) >> BigInt(reserveIndex * 2 + 1)) & 1n) === 1n;
      if (supplied > 0n) collaterals.push({ asset: reserve.asset, amount: decimal(supplied, reserve.asset.decimals), suppliedAmount: decimal(supplied, reserve.asset.decimals), collateralEnabled, accruedInterest: null, apy: Math.expm1(Number(reserveData[2]) / 1e27).toString() });
      const debt = variableDebt + stableDebt;
      if (debt > 0n) debts.push({ asset: reserve.asset, amount: decimal(debt, reserve.asset.decimals), collateralEnabled: false, accruedInterest: null, apy: Math.expm1(Number(reserveData[4]) / 1e27).toString() });
    });
    const collateral = baseValue(BigInt(accountData[0]), baseCurrency, BigInt(baseUnit));
    const debt = baseValue(BigInt(accountData[1]), baseCurrency, BigInt(baseUnit));
    const capacity = baseValue(BigInt(accountData[2]), baseCurrency, BigInt(baseUnit));
    return { collaterals, debts, risk: risk({ healthFactor: BigInt(accountData[5]), ltv: actualLtv(BigInt(accountData[0]), BigInt(accountData[1])), collateral, debt, capacity }), status: collaterals.length || debts.length ? 'open' : 'empty', freshness: { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: block.toString() } };
  }
  const [accountData, premium] = await Promise.all([
    client.readContract({ address: detail.market.venue, abi: v4SpokeAbi, functionName: 'getUserAccountData', args: [account], blockNumber: block }),
    client.readContract({ address: detail.market.venue, abi: v4SpokeAbi, functionName: 'getUserLastRiskPremium', args: [account], blockNumber: block }),
  ]);
  await mapRpc(detail.reserves, async (reserve) => {
    const [supplied, debt, status] = await Promise.all([
      client.readContract({ address: detail.market.venue, abi: v4SpokeAbi, functionName: 'getUserSuppliedAssets', args: [BigInt(reserve.asset.reserveId!), account], blockNumber: block }),
    client.readContract({ address: detail.market.venue, abi: v4SpokeAbi, functionName: 'getUserTotalDebt', args: [BigInt(reserve.asset.reserveId!), account], blockNumber: block }),
      client.readContract({ address: detail.market.venue, abi: v4SpokeAbi, functionName: 'getUserReserveStatus', args: [BigInt(reserve.asset.reserveId!), account], blockNumber: block }),
    ]);
    if (supplied > 0n) collaterals.push({ asset: reserve.asset, amount: decimal(supplied, reserve.asset.decimals), suppliedAmount: decimal(supplied, reserve.asset.decimals), collateralEnabled: status[0], accruedInterest: null });
    if (debt > 0n) {
      let apy: string | null = null;
      try {
        const mapping = await client.readContract({ address: detail.market.venue, abi: v4SpokeAbi, functionName: 'getReserve', args: [BigInt(reserve.asset.reserveId!)], blockNumber: block });
        if (mapping[0].toLowerCase() !== reserve.asset.address.toLowerCase()) throw new Error('Spoke reserve mapping changed.');
        const baseRate = await client.readContract({ address: mapping[1], abi: v4HubAbi, functionName: 'getAssetDrawnRate', args: [BigInt(mapping[2])], blockNumber: block });
        // The stored premium is what accrues; accountData[0] is the recalculated premium.
        const effectiveRate = baseRate + (baseRate * premium + 9_999n) / 10_000n;
        const annualYield = Math.expm1(Number(effectiveRate) / 1e27);
        if (Number.isFinite(annualYield) && annualYield >= 0) apy = annualYield.toString();
      } catch { /* Rate failures must not hide otherwise readable balances and risk. */ }
      debts.push({ asset: reserve.asset, amount: decimal(debt, reserve.asset.decimals), collateralEnabled: false, accruedInterest: null, apy });
    }
  });
  collaterals.sort((a, b) => a.asset.id.localeCompare(b.asset.id));
  debts.sort((a, b) => a.asset.id.localeCompare(b.asset.id));
  // V4 SpokeUtils normalizes values to 1e26 USD and debtValueRay to 1e53
  // (1e26 value units multiplied by RAY). Keep the conversion explicit.
  const collateralValue = BigInt(accountData[3]);
  const debtValueRay = BigInt(accountData[4]);
  const debtValue = debtValueRay / (10n ** 27n);
  const capacityValue = collateralValue * BigInt(accountData[1]) / WAD > debtValue ? collateralValue * BigInt(accountData[1]) / WAD - debtValue : 0n;
  const ltvValue = collateralValue === 0n ? null : decimal(debtValueRay * WAD / (collateralValue * (10n ** 27n)));
  return { collaterals, debts, risk: risk({ healthFactor: BigInt(accountData[2]), ltv: ltvValue, collateral: decimal(collateralValue, 26), debt: decimal(debtValueRay, 53), capacity: decimal(capacityValue, 26), riskPremium: BigInt(premium) }), status: collaterals.length || debts.length ? 'open' : 'empty', freshness: { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: block.toString() } };
}

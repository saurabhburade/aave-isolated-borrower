import { concatHex, encodeAbiParameters, encodePacked, getContractAddress, keccak256, parseAbiParameters } from 'viem';
import type { Address, Asset, BorrowRequest, CreationDeployment, Freshness, Hex, Market, ReviewPlan } from './domain.ts';
import type { ComparisonMarket } from './market-catalog.ts';
import { buildResolvedCreationBatch, DEFAULT_MIN_HEALTH_FACTOR, encodeCreatePosition } from './transaction-batch.ts';

export function predictPositionAddress(deployment: CreationDeployment, market: Pick<Market, 'chainId' | 'version' | 'venue'>, owner: Address, salt: Hex): Address {
  const deploymentSalt = keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,uint8,address,bytes32'), [BigInt(market.chainId), owner, market.version, market.venue, salt]));
  const constructor = encodeAbiParameters(parseAbiParameters('address,uint8,address,bytes32'), [owner, market.version, market.venue, salt]);
  return getContractAddress({ opcode: 'CREATE2', from: deployment.factory, salt: deploymentSalt, bytecode: concatHex([deployment.accountCreationCode, constructor]) });
}

/** Build from the market, rates, and deployment already loaded for the review. */
export function buildSelectedMarketPlan({ deployment, market, request, owner, salt, borrowApr, borrowRateRay, freshness, now = Date.now() }: {
  deployment: CreationDeployment; market: ComparisonMarket; request: BorrowRequest;
  owner: Address; salt: Hex; borrowApr: string; borrowRateRay?: string; freshness: Freshness; now?: number;
}): ReviewPlan {
  if (request.chainId !== market.chainId) throw new Error('The selected market is on a different network.');
  const resolve = (assetId: string, collateral: boolean, enabled = true) => {
    const address = assetId.split('/').at(-1)?.toLowerCase();
    const matches = market.catalog?.reserves.filter(reserve => reserve.address.toLowerCase() === address
      && (collateral ? reserve.canSupply && (!enabled || reserve.canCollateral) : reserve.canBorrow)
      && (market.version !== 4 || !assetId.startsWith(`${market.executionMarketId}/`) || `${market.executionMarketId}/${reserve.reserveId}/${address}` === assetId)) ?? [];
    if (matches.length !== 1) throw new Error('Select an unambiguous reserve from the loaded market.');
    const reserve = matches[0];
    if (market.version === 4 && reserve.reserveId == null) throw new Error('The selected market is missing its reserve ID. Refresh markets.');
    const asset: Asset = { ...reserve, address: reserve.address as Address, id: market.version === 4 ? `${market.executionMarketId}/${reserve.reserveId}/${address}` : `${market.executionMarketId}/${address}` };
    return { asset, reserve };
  };
  const collaterals = request.collaterals.map(input => ({ ...input, ...resolve(input.assetId, true, input.enabled) }));
  const debt = { ...request.debt, ...resolve(request.debt.assetId, false) };
  let premium = 0n;
  if (market.version === 4) for (const row of collaterals.filter(row => row.enabled)) {
    if (row.reserve.collateralRiskBps == null) throw new Error('Collateral risk data is unavailable. Refresh markets.');
    const risk = BigInt(row.reserve.collateralRiskBps);
    if (risk > premium) premium = risk;
  }
  const apr = Number(borrowApr);
  if (!Number.isFinite(apr) || apr < 0) throw new Error('The selected market is missing its borrow rate.');
  const base = borrowRateRay === undefined ? BigInt(Math.ceil(apr * 1e27)) : BigInt(borrowRateRay);
  const rate = base + (base * premium + 9999n) / 10000n;
  const batch = buildResolvedCreationBatch({ version: market.version, collaterals, debt, deadline: BigInt(Math.floor(now / 1000) + 300), minHealthFactor: DEFAULT_MIN_HEALTH_FACTOR, maxBorrowRateRay: rate + rate / 20n + 1n });
  const account = predictPositionAddress(deployment, market, owner, salt);
  const data = encodeCreatePosition(deployment.factory, market, salt, batch);
  const termsHash = keccak256(encodePacked(['bytes32', 'address', 'address', 'uint8', 'bytes'], [salt, owner, account, market.version, data]));
  const assets = [...collaterals.map(row => row.asset), debt.asset];
  return {
    id: `${market.executionMarketId}:${account.toLowerCase()}:${termsHash}`, intentSalt: salt, owner, account,
    market: { ...market, id: market.executionMarketId ?? market.id, assets }, request,
    estimatedBorrowApr: borrowApr,
    approvals: collaterals.map((row, index) => ({ token: row.asset, spender: account, amount: batch.funding[index].amount.toString() })),
    transaction: { to: deployment.factory, data, value: '0' }, riskBefore: null, riskAfter: null,
    minHealthFactor: batch.limits.minHealthFactor.toString(), maxBorrowRateRay: batch.limits.maxBorrowRateRay.toString(), deadline: batch.limits.deadline.toString(), freshness, termsHash,
    movements: [...collaterals.map(row => ({ asset: row.asset, amount: row.amount, direction: 'owner-to-account' as const })), { asset: debt.asset, amount: debt.amount, direction: 'account-to-owner' }],
  };
}

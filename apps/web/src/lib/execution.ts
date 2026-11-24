import { decodeFunctionResult, encodeFunctionData, keccak256, encodePacked, formatUnits, type Address, type Hex, type PublicClient } from 'viem';
import { simulateCalls } from 'viem/actions';
import type { Approval, BorrowRequest, Market, MarketQuote, ManagementAction, ReviewPlan, RiskMetrics } from './domain.ts';
import { accountAbi, erc20Abi, factoryAbi, v3PoolAbi, v4SpokeAbi, v4HubAbi } from './abis.ts';
import { compatibleReserve, type Discovery, type MarketDiscovery } from './discovery.ts';
import { localAddress, assertSalt, decimalAmount, MAX_UINT256, LOCAL_CHAIN_ID } from './validation.ts';
import { nativeExecutionFailure } from './native-errors.ts';
import { ACTION, DEFAULT_MIN_HEALTH_FACTOR, encodeExecute, encodeCreatePosition, buildResolvedCreationBatch, buildResolvedManagementBatch, type NativeAction, type NativeLimits } from './transaction-batch.ts';
export { ACTION, DEFAULT_MIN_HEALTH_FACTOR, encodeExecute, encodeCreatePosition } from './transaction-batch.ts';
export type { NativeAction, NativeLimits } from './transaction-batch.ts';

const MAX_REVIEW_DEADLINE_SECONDS = 30 * 60;

export interface ReviewedLimits { deadline: string; minHealthFactor: string; maxBorrowRateRay: string }

export function accountAddress(client: PublicClient, factory: Address, owner: Address, market: Market, salt: Hex): Promise<Address> {
  return client.readContract({ address: factory, abi: factoryAbi, functionName: 'predictPosition', args: [owner, market.version, market.venue, salt] });
}

export function buildCreateBatch(detail: MarketDiscovery, request: BorrowRequest, minHealthFactor = DEFAULT_MIN_HEALTH_FACTOR, deadline = BigInt(Math.floor(Date.now() / 1000) + 300), maxBorrowRateRay?: bigint) {
  if (detail.market.status !== 'available') throw new Error(detail.market.reason ?? 'Market unavailable.');
  if (request.chainId !== LOCAL_CHAIN_ID) throw new Error('Wrong chain.');
  const seen = new Set<string>();
  const collaterals = request.collaterals.map(input => {
    const reserve = compatibleReserve(detail, input.assetId, 'collateral');
    if (!reserve?.canSupply || (input.enabled && !reserve.canCollateral)) throw new Error(`Collateral reserve ${input.assetId} is not eligible on this market.`);
    if (seen.has(input.assetId)) throw new Error('Duplicate reserve in action batch.');
    seen.add(input.assetId);
    return { ...input, asset: reserve.asset };
  });
  const debt = compatibleReserve(detail, request.debt.assetId, 'debt');
  if (!debt?.canBorrow) throw new Error(`Debt reserve ${request.debt.assetId} is not borrowable on this market.`);
  const nativeRate = maxBorrowRateRay ?? (debt.borrowRateRay ? BigInt(debt.borrowRateRay) + BigInt(debt.borrowRateRay) / 20n : undefined);
  if (nativeRate === undefined) throw new Error('Native borrow rate is not available for this verified deployment.');
  return buildResolvedCreationBatch({ version: detail.market.version, collaterals, debt: { ...request.debt, asset: debt.asset }, deadline, minHealthFactor, maxBorrowRateRay: nativeRate });
}

export async function approvalPlan(client: PublicClient, owner: Address, spender: Address, detail: MarketDiscovery, request: BorrowRequest): Promise<Approval[]> {
  const approvals: Approval[] = [];
  for (const input of request.collaterals) {
    const reserve = compatibleReserve(detail, input.assetId, 'collateral');
    if (!reserve) throw new Error(`Unknown collateral reserve ${input.assetId}.`);
    const amount = decimalAmount(input.amount, reserve.asset.decimals, 'collateral amount');
    const current = await client.readContract({ address: reserve.asset.address, abi: erc20Abi, functionName: 'allowance', args: [owner, spender] });
    approvals.push({ token: reserve.asset, spender, amount: amount.toString(), currentAllowance: current.toString() });
  }
  return approvals;
}

export async function simulateCreate(client: PublicClient, factory: Address, owner: Address, market: Market, salt: Hex, batch: ReturnType<typeof buildCreateBatch>): Promise<{ ok: boolean; reason?: string }> {
  try {
    await client.simulateContract({ address: factory, abi: factoryAbi, functionName: 'createPosition', args: [market.version, market.venue, salt, batch.funding, batch.actions, batch.limits], account: owner });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.slice(0, 240) : 'Native create simulation reverted.' };
  }
}

export async function simulateExecute(client: PublicClient, account: Address, owner: Address, batch: ReturnType<typeof buildManagementBatch>): Promise<{ ok: boolean; reason?: string }> {
  try {
    const funding = batch.funding.map((item) => [item.token, item.amount] as const);
    const actions = batch.actions.map((item) => [item.kind, item.token, item.reserveId, item.amount, item.enabled] as const);
    const limits = [batch.limits.deadline, batch.limits.minHealthFactor, batch.limits.maxBorrowRateRay] as const;
    await client.simulateContract({ address: account, abi: accountAbi, functionName: 'execute', args: [funding, actions, limits], account: owner });
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.slice(0, 240) : 'Native management simulation reverted.' };
  }
}

function simulatedRisk(detail: MarketDiscovery, data: Hex): RiskMetrics {
  if (detail.market.version === 3) {
    const result = decodeFunctionResult({ abi: v3PoolAbi, functionName: 'getUserAccountData', data }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint];
    return { healthFactor: result[1] === 0n ? null : formatUnits(result[5], 18), ltv: result[0] === 0n ? null : formatUnits(result[1] * (10n ** 18n) / result[0], 18), borrowCapacityUsd: detail.usdDecimals === undefined ? null : formatUnits(result[2], detail.usdDecimals), collateralUsd: detail.usdDecimals === undefined ? null : formatUnits(result[0], detail.usdDecimals), debtUsd: detail.usdDecimals === undefined ? null : formatUnits(result[1], detail.usdDecimals) };
  }
  const result = decodeFunctionResult({ abi: v4SpokeAbi, functionName: 'getUserAccountData', data }) as readonly [bigint, bigint, bigint, bigint, bigint, bigint, bigint];
  const collateralValue = result[3];
  const debtValueRay = result[4];
  const debtValue = debtValueRay / (10n ** 27n);
  const capacityValue = collateralValue * result[1] / (10n ** 18n) > debtValue ? collateralValue * result[1] / (10n ** 18n) - debtValue : 0n;
  return { healthFactor: debtValue === 0n ? null : formatUnits(result[2], 18), ltv: collateralValue === 0n ? null : formatUnits(debtValueRay * (10n ** 18n) / (collateralValue * (10n ** 27n)), 18), borrowCapacityUsd: formatUnits(capacityValue, 26), collateralUsd: formatUnits(collateralValue, 26), debtUsd: formatUnits(debtValueRay, 53), riskPremiumBps: formatUnits(result[0], 0) };
}

type SimCall = { to: Address; data: Hex; value: bigint };

interface NativeSimulation {
  ok: boolean; reason?: string; risk?: RiskMetrics; blockNumber?: string;
  executionError?: MarketQuote['executionError'];
  borrowRateRay?: string; baseBorrowRateRay?: string;
}

async function ethSimulatePostState(client: PublicClient, calls: SimCall[], detail: MarketDiscovery, positionAccount: Address, owner: Address, actions: NativeAction[]): Promise<NativeSimulation> {
  try {
    const riskData = detail.market.version === 3
      ? encodeFunctionData({ abi: v3PoolAbi, functionName: 'getUserAccountData', args: [positionAccount] })
      : encodeFunctionData({ abi: v4SpokeAbi, functionName: 'getUserAccountData', args: [positionAccount] });
    const borrowed = actions.filter(action => action.kind === ACTION.borrow);
    const rateCalls = await Promise.all(borrowed.map(async action => {
      if (detail.market.version === 3) return { to: detail.market.venue, data: encodeFunctionData({ abi: v3PoolAbi, functionName: 'getReserveData', args: [action.token] }), value: 0n };
      const reserve = await client.readContract({ address: detail.market.venue, abi: v4SpokeAbi, functionName: 'getReserve', args: [action.reserveId] });
      if (reserve[0].toLowerCase() !== action.token.toLowerCase()) throw new Error('Spoke reserve mapping changed.');
      return { to: reserve[1], data: encodeFunctionData({ abi: v4HubAbi, functionName: 'getAssetDrawnRate', args: [BigInt(reserve[2])] }), value: 0n };
    }));
    const simulation = await simulateCalls(client, { account: owner, calls: [...calls, { to: detail.market.venue, data: riskData, value: 0n }, ...rateCalls], blockTag: 'latest', validation: false });
    const results = simulation.results;
    if (results.length !== calls.length + 1 + rateCalls.length) return { ok: false, reason: 'RPC returned an incomplete native simulation.' };
    const failed = results.find(call => call.status === 'failure');
    if (failed?.status === 'failure') {
      return { ok: false, ...nativeExecutionFailure(failed.data) };
    }
    const risk = simulatedRisk(detail, results[calls.length].data);
    let maximumBase = 0n;
    for (let index = 0; index < rateCalls.length; index++) {
      const data = results[calls.length + 1 + index].data;
      const base = detail.market.version === 3
        ? BigInt(decodeFunctionResult({ abi: v3PoolAbi, functionName: 'getReserveData', data })[4])
        : decodeFunctionResult({ abi: v4HubAbi, functionName: 'getAssetDrawnRate', data });
      if (base > maximumBase) maximumBase = base;
    }
    return { ok: true, risk, blockNumber: simulation.block.number?.toString(), ...(rateCalls.length ? { baseBorrowRateRay: maximumBase.toString(), borrowRateRay: effectiveBorrowRateRay(detail, maximumBase, risk).toString() } : {}) };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? `Native simulation unavailable: ${error.message.slice(0, 300)}` : 'Native simulation unavailable.' };
  }
}

function approvalCalls(spender: Address, funding: Array<{ token: Address; amount: bigint }>): SimCall[] {
  return funding.flatMap(item => [0n, item.amount].map(amount => ({ to: item.token, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spender, amount] }), value: 0n })));
}

async function fundingReason(client: PublicClient, owner: Address, funding: Array<{ token: Address; amount: bigint }>, detail: MarketDiscovery): Promise<string | undefined> {
  const balances = await Promise.all(funding.map(item => client.readContract({ address: item.token, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })));
  for (let index = 0; index < funding.length; index++) {
    const item = funding[index];
    if (balances[index] >= item.amount) continue;
    const asset = detail.reserves.find(reserve => reserve.asset.address.toLowerCase() === item.token.toLowerCase())?.asset;
    if (!asset) return 'Insufficient collateral token balance in the connected wallet.';
    return `Insufficient ${asset.symbol} balance: need ${formatUnits(item.amount, asset.decimals)}, have ${formatUnits(balances[index], asset.decimals)}. Fund your wallet on chain ${LOCAL_CHAIN_ID} before execution.`;
  }
}

export async function simulateCreatePostStateExact(client: PublicClient, factory: Address, owner: Address, market: Market, salt: Hex, account: Address, batch: ReturnType<typeof buildCreateBatch>, detail: MarketDiscovery): Promise<NativeSimulation> {
  const reason = await fundingReason(client, owner, batch.funding, detail);
  if (reason) return { ok: false, reason };
  return ethSimulatePostState(client, [...approvalCalls(account, batch.funding), { to: factory, data: encodeCreatePosition(factory, market, salt, batch), value: 0n }], detail, account, owner, batch.actions);
}

export async function simulateExecutePostState(client: PublicClient, account: Address, owner: Address, batch: ReturnType<typeof buildManagementBatch>, detail: MarketDiscovery): Promise<NativeSimulation> {
  return ethSimulatePostState(client, [...approvalCalls(account, batch.funding), { to: account, data: encodeExecute(batch), value: 0n }], detail, account, owner, batch.actions);
}

export function quoteRiskUnavailable(reason: string): RiskMetrics {
  return { healthFactor: null, ltv: null, borrowCapacityUsd: null, collateralUsd: null, debtUsd: null, riskPremiumBps: null };
}

function effectiveBorrowRateRay(detail: MarketDiscovery, baseRateRay: bigint, risk: RiskMetrics): bigint {
  if (detail.market.version !== 4 || !risk.riskPremiumBps) return baseRateRay;
  const premiumBps = BigInt(risk.riskPremiumBps);
  return baseRateRay + (baseRateRay * premiumBps + 9_999n) / 10_000n;
}

export async function quoteDiscovery(client: PublicClient, factory: Address, owner: Address | undefined, request: BorrowRequest, discovery: Discovery, salt?: Hex): Promise<MarketQuote[]> {
  const quotes: MarketQuote[] = [];
  for (const detail of discovery.details.values()) {
    const freshness = detail.freshness;
    const reasons: string[] = [];
    const executionReasons: string[] = [];
    let executionError: MarketQuote['executionError'];
    if (detail.market.status !== 'available') reasons.push(detail.market.reason ?? 'Market unavailable.');
    for (const input of request.collaterals) {
      const reserve = compatibleReserve(detail, input.assetId, 'collateral');
      if (!reserve) reasons.push(`Collateral ${input.assetId} is not listed in this venue.`);
      else if (!reserve.canSupply) reasons.push(`${reserve.asset.symbol} cannot be supplied now.`);
      else if (input.enabled && !reserve.canCollateral) reasons.push(`${reserve.asset.symbol} cannot be enabled as collateral now.`);

    }
    const debt = compatibleReserve(detail, request.debt.assetId, 'debt');
    if (!debt) reasons.push(`Debt ${request.debt.assetId} is not listed in this venue.`);
    else if (!debt.canBorrow) reasons.push(`${debt.asset.symbol} cannot be borrowed now.`);
    const rate = debt?.borrowRateRay ? BigInt(debt.borrowRateRay) : undefined;
    if (rate === undefined) reasons.push('The verified venue does not expose a native borrow rate through the configured ABI.');
    let executable = false;
    let predictedAccount: Address | undefined;
    let amountRate = rate;
    let amountBaseRate = rate;
    let quoteRisk = quoteRiskUnavailable('Risk is only reported from native post-action state.');
    let quoteFreshness = freshness;
    if (reasons.length === 0 && rate !== undefined && owner && salt) {
      try {
        const account = await accountAddress(client, factory, owner, detail.market, salt);
        predictedAccount = account;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
        const probeBatch = buildCreateBatch(detail, request, DEFAULT_MIN_HEALTH_FACTOR, deadline, MAX_UINT256);
        const probe = await simulateCreatePostStateExact(client, factory, owner, detail.market, salt, account, probeBatch, detail);
        const probeRisk = probe.risk ?? quoteRisk;
        if (!probe.ok) {
          executable = false;
          if (probe.reason) executionReasons.push(probe.reason);
        }
        const finalRate = probe.borrowRateRay ? BigInt(probe.borrowRateRay) : effectiveBorrowRateRay(detail, rate, probeRisk);
        const batch = buildCreateBatch(detail, request, DEFAULT_MIN_HEALTH_FACTOR, deadline, finalRate + finalRate / 20n);
        const simulated = probe.ok
          ? await simulateCreatePostStateExact(client, factory, owner, detail.market, salt, account, batch, detail)
          : probe;
        executable = simulated.ok;
        executionError = simulated.executionError;
        if (simulated.borrowRateRay) amountRate = BigInt(simulated.borrowRateRay);
        if (simulated.baseBorrowRateRay) amountBaseRate = BigInt(simulated.baseBorrowRateRay);
        if (simulated.risk) quoteRisk = simulated.risk;
        if (!simulated.ok && simulated.reason && !executionReasons.includes(simulated.reason)) executionReasons.push(simulated.reason);
        if (simulated.ok) quoteFreshness = { ...freshness, ...(simulated.blockNumber ? { blockNumber: simulated.blockNumber } : {}) };
      } catch { executionReasons.push('Execution checks are temporarily unavailable. Refresh the quote before reviewing.'); }
    }
    // Market compatibility and observed rates remain available even when
    // wallet execution fails. Only successful simulations report position risk.
    const effectiveRate = amountRate;
    const apr = effectiveRate === undefined ? null : Number(effectiveRate) / 1e27;
    const baseApr = amountBaseRate === undefined ? null : Number(amountBaseRate) / 1e27;
    const apy = apr === null ? null : Math.expm1(apr);
    const requested = new Set([...request.collaterals.map(input => compatibleReserve(detail, input.assetId, 'collateral')?.asset.id), debt?.asset.id]);
    const constraints = detail.reserves.filter(reserve => requested.has(reserve.asset.id)).map(reserve => ({ asset: reserve.asset, supplyRemaining: reserve.supplyCapRemaining ?? null, borrowRemaining: reserve.borrowCapRemaining ?? null, liquidity: reserve.liquidity, supplyUncapped: reserve.supplyUncapped ?? false, borrowUncapped: reserve.borrowUncapped ?? false }));
    quotes.push({ ...(executionError ? { executionError } : {}), account: predictedAccount, borrowRateRay: amountRate?.toString(), constraints, marketId: detail.market.id, eligible: reasons.length === 0, reasons, executionReasons, rateSource: executable ? 'simulation' : 'market', borrowApy: apy === null ? null : apy.toString(), borrowApr: apr === null ? null : apr.toString(), baseBorrowApr: baseApr === null ? null : baseApr.toString(), risk: quoteRisk, liquidity: debt?.liquidity ?? null, supplyCapRemaining: null, borrowCapRemaining: debt?.borrowCapRemaining ?? null, executable, freshness: quoteFreshness });
  }
  return quotes;
}

function parseReviewedUint(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new Error(`${field} must be an unsigned decimal integer.`);
  return BigInt(value);
}

function reviewLimits(detail: MarketDiscovery, request: BorrowRequest, quote: MarketQuote, reviewed: unknown): NativeLimits | undefined {
  if (reviewed === undefined) return undefined;
  if (!reviewed || typeof reviewed !== 'object') throw new Error('reviewedLimits must be an object.');
  const input = reviewed as Record<string, unknown>;
  const deadline = parseReviewedUint(input.deadline, 'reviewedLimits.deadline');
  const minHealthFactor = parseReviewedUint(input.minHealthFactor, 'reviewedLimits.minHealthFactor');
  const maxBorrowRateRay = parseReviewedUint(input.maxBorrowRateRay, 'reviewedLimits.maxBorrowRateRay');
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (deadline <= now || deadline > now + BigInt(MAX_REVIEW_DEADLINE_SECONDS)) throw new Error('reviewedLimits.deadline must be unexpired and within the review window.');
  if (minHealthFactor < DEFAULT_MIN_HEALTH_FACTOR) throw new Error('reviewedLimits.minHealthFactor is below the policy minimum.');
  if (maxBorrowRateRay <= 0n || maxBorrowRateRay > MAX_UINT256) throw new Error('reviewedLimits.maxBorrowRateRay is out of range.');
  const debt = compatibleReserve(detail, request.debt.assetId, 'debt');
  const baseRate = debt?.borrowRateRay ? BigInt(debt.borrowRateRay) : undefined;
  if (baseRate !== undefined && maxBorrowRateRay < effectiveBorrowRateRay(detail, baseRate, quote.risk)) throw new Error('reviewedLimits.maxBorrowRateRay is below the current native borrow rate.');
  return { deadline, minHealthFactor, maxBorrowRateRay };
}

export async function buildReviewPlan(client: PublicClient, factory: Address, ownerValue: unknown, saltValue: unknown, request: BorrowRequest, detail: MarketDiscovery, quote?: MarketQuote, reviewedLimits?: unknown): Promise<ReviewPlan> {
  const owner = localAddress(ownerValue, 'owner');
  const salt = assertSalt(saltValue);
  if (request.chainId !== LOCAL_CHAIN_ID) throw new Error('Only the verified local chain is available.');
  if (detail.market.status !== 'available') throw new Error(detail.market.reason ?? 'Market unavailable.');
  if (!quote?.eligible) throw new Error(`This market is unavailable: ${(quote?.reasons ?? ['No quote was found.']).join(' ')}`);
  if (detail.freshness.status !== 'fresh') throw new Error('Market data is stale. Refresh before signing.');
  if (quote.executionError) throw Object.assign(new Error(quote.executionReasons.join(' ')), { code: quote.executionError });
  const debt = compatibleReserve(detail, request.debt.assetId, 'debt');
  const rate = debt?.borrowRateRay ? BigInt(debt.borrowRateRay) : undefined;
  // Bound V4's collateral premium using the highest enabled collateral risk.
  // This requires only observed reserve data, without executing a simulated batch.
  const premium = detail.market.version === 4 ? request.collaterals.filter(input => input.enabled).reduce((max, input) => {
    const risk = BigInt(compatibleReserve(detail, input.assetId, 'collateral')?.collateralRiskBps ?? '0');
    return risk > max ? risk : max;
  }, 0n) : 0n;
  const quotedRate = rate === undefined ? undefined : effectiveBorrowRateRay(detail, rate, { ...quote.risk, riskPremiumBps: premium.toString() });
  const reviewed = reviewLimits(detail, request, quote, reviewedLimits);
  const deadline = reviewed?.deadline ?? BigInt(Math.floor(Date.now() / 1000) + 300);
  const minHealthFactor = reviewed?.minHealthFactor ?? DEFAULT_MIN_HEALTH_FACTOR;
  const maxBorrowRateRay = reviewed?.maxBorrowRateRay ?? (quotedRate === undefined ? undefined : quotedRate + quotedRate / 20n);
  const batch = buildCreateBatch(detail, request, minHealthFactor, deadline, maxBorrowRateRay);
  const account = await accountAddress(client, factory, owner, detail.market, salt);
  const code = await client.getBytecode({ address: account });
  if (code && code !== '0x') throw Object.assign(new Error('Position already exists. Start a new position.'), { code: 'position_exists' });
  const reason = await fundingReason(client, owner, batch.funding, detail);
  if (reason) throw new Error(reason);
  const approvals = await approvalPlan(client, owner, account, detail, request);
  const transaction = { to: factory, data: encodeCreatePosition(factory, detail.market, salt, batch), value: '0' };
  const termsHash = keccak256(encodePacked(['bytes32', 'address', 'address', 'uint8', 'bytes'], [salt, owner, account, detail.market.version, transaction.data]));
  const movements: ReviewPlan['movements'] = request.collaterals.map((input) => ({ asset: compatibleReserve(detail, input.assetId, 'collateral')!.asset, amount: input.amount, direction: 'owner-to-account' as const }));
  movements.push({ asset: debt!.asset, amount: request.debt.amount, direction: 'account-to-owner' as const });
  return { id: `${detail.market.id}:${account.toLowerCase()}:${termsHash}`, intentSalt: salt, owner, account, market: detail.market, estimatedBorrowApr: quote.borrowApr ?? undefined, request, approvals, transaction, riskBefore: null, riskAfter: null, minHealthFactor: batch.limits.minHealthFactor.toString(), maxBorrowRateRay: batch.limits.maxBorrowRateRay.toString(), deadline: batch.limits.deadline.toString(), freshness: detail.freshness, termsHash, movements };
}

export function buildManagementBatch(detail: MarketDiscovery, actions: ManagementAction[], deadline = BigInt(Math.floor(Date.now() / 1000) + 300)) {
  if (detail.market.status !== 'available') throw new Error(detail.market.reason ?? 'Market unavailable.');
  const items = actions.map(action => {
    const reserve = compatibleReserve(detail, action.assetId, action.kind === 'borrow' || action.kind === 'repay' || action.kind === 'repay-all' ? 'debt' : 'collateral');
    if (!reserve) throw new Error(`Unknown reserve ${action.assetId}.`);
    return { action, asset: reserve.asset, borrowRateRay: reserve.borrowRateRay };
  });
  return buildResolvedManagementBatch(items, deadline);
}

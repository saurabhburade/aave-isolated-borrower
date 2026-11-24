import { encodePacked, formatUnits, keccak256 } from 'viem';
import type { ApiError, BorrowRequest, ManagementAction, Approval } from './domain.ts';
import { createLocalClient, loadCreationDeployment, loadDeploymentManifest } from './deployment.ts';
import { compatibleReserve, discoverMarkets } from './discovery.ts';
import { buildManagementBatch, buildReviewPlan, encodeExecute, quoteDiscovery } from './execution.ts';
import { loadPortfolio, loadPosition } from './portfolio.ts';
import { localAddress, validateBorrowRequest, validateManagementActions, assertSalt, MAX_UINT256, LOCAL_CHAIN_ID } from './validation.ts';
import { repayFunding } from './transaction-batch.ts';
import { enrichTokenMetadata } from './server-token-metadata.ts';

export function json<T>(body: T, status = 200): Response { return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } }); }
export function errorResponse(error: unknown, status = 400): Response { const body: ApiError = { error: error instanceof Error ? error.message : 'Request failed.', code: error instanceof Error && 'code' in error && error.code === 'position_exists' ? 'position_exists' : status >= 500 ? 'unavailable' : 'invalid_request' }; return json(body, status); }
export async function readJson(request: Request): Promise<unknown> { try { return await request.json(); } catch { throw new Error('Request body must be valid JSON.'); } }

export async function getMarkets(summary = false) {
  const [discovery, deployment] = await Promise.all([discoverMarkets(undefined, { summary }), loadDeploymentManifest()]);
  const creationDeployment = await loadCreationDeployment(deployment.manifest);
  const assets = await enrichTokenMetadata(discovery.assets);
  const metadata = new Map(assets.map(asset => [asset.address.toLowerCase(), asset]));
  const markets = discovery.markets.map(market => ({ ...market, assets: market.assets.map(asset => {
    const token = metadata.get(asset.address.toLowerCase());
    return token ? { ...asset, name: token.name, icon: token.icon } : asset;
  }) }));
  return { markets, assets, freshness: discovery.freshness, creationDeployment };
}

export async function postQuotes(body: unknown) {
  const request = validateBorrowRequest(body);
  const input = body as Record<string, unknown>;
  const hasOwner = input.owner !== undefined;
  const hasSalt = input.salt !== undefined;
  if (hasOwner !== hasSalt) throw new Error('owner and salt must be supplied together for an exact native quote.');
  const owner = hasOwner ? localAddress(input.owner, 'owner') : undefined;
  const salt = hasSalt ? assertSalt(input.salt) : undefined;
  if (input.marketId !== undefined && typeof input.marketId !== 'string') throw new Error('marketId must be a string.');
  const [deployment, discovery, client] = await Promise.all([loadDeploymentManifest(), discoverMarkets(undefined, { marketIds: typeof input.marketId === 'string' ? [input.marketId] : undefined, assetIds: [...request.collaterals.map(row => row.assetId), request.debt.assetId] }), Promise.resolve(createLocalClient())]);
  if (!deployment.manifest) return { quotes: [], freshness: discovery.freshness };
  const quotes = await quoteDiscovery(client, deployment.manifest.factory, owner, request, discovery, salt);
  const selected = typeof input.marketId === 'string' ? discovery.details.get(input.marketId) : undefined;
  const quote = quotes.find(candidate => candidate.marketId === input.marketId);
  const reviewPlan = owner && salt && selected && quote?.executable
    ? await buildReviewPlan(client, deployment.manifest.factory, owner, salt, request, selected, quote)
    : undefined;
  return { quotes, reviewPlan, freshness: discovery.freshness };
}

export async function postPrepare(body: unknown) {
  if (!body || typeof body !== 'object') throw new Error('Prepare request is required.');
  const input = body as Record<string, unknown>;
  const request = validateBorrowRequest(input.request);
  const marketId = input.marketId;
  if (typeof marketId !== 'string') throw new Error('marketId is required.');
  const owner = localAddress(input.owner, 'owner');
  const salt = assertSalt(input.salt);
  const [deployment, discovery, client] = await Promise.all([loadDeploymentManifest(), discoverMarkets(undefined, { marketIds: [marketId], assetIds: [...request.collaterals.map(row => row.assetId), request.debt.assetId] }), Promise.resolve(createLocalClient())]);
  if (!deployment.manifest) throw new Error('No verified local deployment is available.');
  const detail = discovery.details.get(marketId);
  if (!detail) throw new Error('Selected market is unavailable.');
  const quotes = await quoteDiscovery(client, deployment.manifest.factory, undefined, request, { ...discovery, details: new Map([[marketId, detail]]) });
  const quote = quotes.find((candidate) => candidate.marketId === marketId);
  return buildReviewPlan(client, deployment.manifest.factory, owner, salt, request, detail, quote, input.reviewedLimits);
}

export async function getPositions(ownerValue: string | null, chainIdValue: string | null) {
  if (!ownerValue) throw new Error('owner is required.');
  const chainId = Number(chainIdValue ?? LOCAL_CHAIN_ID);
  if (!Number.isInteger(chainId)) throw new Error('chainId must be an integer.');
  return loadPortfolio(ownerValue, chainId);
}

export async function getPosition(accountValue: string, ownerValue: string | null, chainIdValue: string | null) {
  if (!ownerValue) throw new Error('owner is required.');
  const chainId = Number(chainIdValue ?? LOCAL_CHAIN_ID);
  if (!Number.isInteger(chainId)) throw new Error('chainId must be an integer.');
  return loadPosition(accountValue, ownerValue, chainId);
}

export async function postManage(body: unknown) {
  if (!body || typeof body !== 'object') throw new Error('Manage request is required.');
  const input = body as Record<string, unknown>;
  const positionId = input.positionId;
  if (typeof positionId !== 'string') throw new Error('positionId is required.');
  const owner = localAddress(input.owner, 'owner');
  const actions = validateManagementActions(input.actions) as ManagementAction[];
  const identity = positionId.split('/');
  if (identity.length !== 2 || identity[0] !== String(LOCAL_CHAIN_ID)) throw new Error('Position identity must match the local chain.');
  const account = identity[1];
  if (!account) throw new Error('positionId is invalid.');
  const selected = await loadPosition(account, owner);
  if (!selected.position) throw new Error('Position is unknown or not owned by this owner.');
  const discovery = await discoverMarkets(undefined, { marketIds: [selected.position.market.id], assetIds: [...selected.position.collaterals.map(balance => balance.asset.id), ...selected.position.debts.map(balance => balance.asset.id), ...actions.flatMap(action => action.assetId ? [action.assetId] : [])] });
  const detail = discovery.details.get(selected.position.market.id);
  const deployment = await loadDeploymentManifest();
  if (!detail || !deployment.manifest) throw new Error('Position market is unavailable.');
  const expanded: ManagementAction[] = [];
  for (const action of actions) {
    if (action.kind === 'close') {
      for (const debt of selected.position.debts) {
        const reserve = compatibleReserve(detail, debt.asset.id, 'debt');
        if (!reserve) throw new Error(`Debt reserve ${debt.asset.id} is no longer discoverable.`);
        const current = BigInt(requireAmount(debt.amount, reserve.asset.decimals));
        expanded.push({ kind: 'repay-all', assetId: debt.asset.id, amount: formatUnits(repayFunding(current, reserve.borrowRateRay), reserve.asset.decimals) });
      }
      for (const collateral of selected.position.collaterals) expanded.push({ kind: 'withdraw', assetId: collateral.asset.id, amount: ((1n << 256n) - 1n).toString() });
    } else if (action.kind === 'repay-all' && action.amount === undefined) {
      const debt = selected.position.debts.find((candidate) => candidate.asset.id === action.assetId);
      const reserve = compatibleReserve(detail, action.assetId, 'debt');
      if (!debt || !reserve) throw new Error(`Debt reserve ${action.assetId} is not present in the current native state.`);
      expanded.push({ ...action, amount: formatUnits(repayFunding(BigInt(requireAmount(debt.amount, reserve.asset.decimals)), reserve.borrowRateRay), reserve.asset.decimals) });
    } else expanded.push(action);
  }
  if (expanded.length === 0) throw new Error('No management action remains after close expansion.');
  const batch = buildManagementBatch(detail, expanded);
  const approvals: Approval[] = [];
  for (const funding of batch.funding) {
    const asset = detail.market.assets.find((candidate) => candidate.address.toLowerCase() === funding.token.toLowerCase());
    if (!asset) throw new Error('Management funding token is not bound to the selected market.');
    approvals.push({ token: asset, spender: selected.position.account, amount: funding.amount.toString() });
  }
  const transaction = { to: selected.position.account, data: encodeExecute(batch), value: '0' };
  const termsHash = keccak256(encodePacked(['address', 'bytes'], [selected.position.account, transaction.data]));
  const movements = batch.funding.map(funding => ({
    asset: detail.market.assets.find(asset => asset.address.toLowerCase() === funding.token.toLowerCase())!,
    amount: formatUnits(funding.amount, detail.market.assets.find(asset => asset.address.toLowerCase() === funding.token.toLowerCase())!.decimals),
    direction: 'owner-to-account' as const,
  }));
  const payouts = expanded.filter(action => action.kind === 'withdraw' || action.kind === 'borrow').map(action => {
    const reserve = compatibleReserve(detail, action.assetId, action.kind === 'borrow' ? 'debt' : 'collateral')!;
    return { asset: reserve.asset, amount: action.amount === ((1n << 256n) - 1n).toString() ? selected.position!.collaterals.find(balance => balance.asset.id === reserve.asset.id)?.amount ?? '0' : action.amount!, direction: 'account-to-owner' as const };
  });
  return { id: `${selected.position.id}:${termsHash}`, intentSalt: selected.position.salt, owner, account: selected.position.account, market: selected.position.market, managementActions: expanded, approvals, transaction, riskBefore: selected.position.risk, riskAfter: null, minHealthFactor: batch.limits.minHealthFactor.toString(), maxBorrowRateRay: batch.limits.maxBorrowRateRay.toString(), deadline: batch.limits.deadline.toString(), freshness: selected.position.freshness, termsHash, movements: [...movements, ...payouts] };
}

function requireAmount(value: string, decimals: number): string {
  if (!/^\d+(?:\.\d+)?$/.test(value)) throw new Error('Native amount is not a decimal value.');
  const [whole, fraction = ''] = value.split('.');
  if (fraction.length > decimals) throw new Error('Native amount has unsupported precision.');
  return whole + fraction.padEnd(decimals, '0');
}


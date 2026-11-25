import { encodePacked, formatUnits, keccak256 } from 'viem';
import type { Asset, Balance, ManagementAction, Position, ReviewPlan } from './domain.ts';
import { buildResolvedManagementBatch, encodeExecute, type ResolvedManagementAction } from './transaction-batch.ts';
import { fullRepaymentFunding } from './repayment.ts';
import { MAX_UINT256 } from './validation.ts';

/** Encode from the loaded position; no discovery, simulation, or RPC requests. */
export function buildPositionManagementPlan(position: Position, action: ManagementAction, now = Date.now()): ReviewPlan {
  const items: ResolvedManagementAction[] = [];
  const assets = [...position.market.assets, ...position.collaterals.map(balance => balance.asset), ...position.debts.map(balance => balance.asset)];
  const add = (action: ManagementAction, asset: Asset) => items.push({ action, asset });
  const fullRepayment = (balance: Balance) => {
    const funding = fullRepaymentFunding(balance, position.freshness, now);
    add({ kind: 'repay-all', assetId: balance.asset.id, amount: formatUnits(funding, balance.asset.decimals) }, balance.asset);
  };
  if (action.kind === 'close') {
    position.debts.forEach(fullRepayment);
    position.collaterals.forEach(balance => add({ kind: 'withdraw', assetId: balance.asset.id, amount: MAX_UINT256.toString() }, balance.asset));
  } else if (action.kind === 'repay-all') {
    const debt = position.debts.find(balance => balance.asset.id === action.assetId);
    if (!debt) throw new Error('The selected debt is not in this position.');
    fullRepayment(debt);
  } else {
    if (!['supply', 'withdraw', 'repay'].includes(action.kind)) throw new Error('Unsupported position management action.');
    const asset = assets.find(candidate => candidate.id === action.assetId);
    if (!asset) throw new Error('The selected token is not in this position.');
    add(action, asset);
  }
  const batch = buildResolvedManagementBatch(items, BigInt(Math.floor(now / 1000) + 300));
  const data = encodeExecute(batch);
  const termsHash = keccak256(encodePacked(['address', 'bytes'], [position.account, data]));
  const approvals = batch.funding.map(funding => ({
    token: items.find(item => item.asset.address.toLowerCase() === funding.token.toLowerCase())!.asset,
    spender: position.account, amount: funding.amount.toString(),
  }));
  const movements: ReviewPlan['movements'] = items.map(({ action, asset }) => ({
    asset,
    amount: action.kind === 'withdraw' && action.amount === MAX_UINT256.toString()
      ? position.collaterals.find(balance => balance.asset.id === asset.id)?.amount ?? '0'
      : action.amount!,
    direction: action.kind === 'withdraw' ? 'account-to-owner' : 'owner-to-account',
  }));
  return {
    id: `${position.id}:${termsHash}`, intentSalt: position.salt, owner: position.owner,
    account: position.account, market: position.market, managementActions: items.map(item => item.action),
    approvals, transaction: { to: position.account, data, value: '0' },
    riskBefore: position.risk, riskAfter: null,
    minHealthFactor: batch.limits.minHealthFactor.toString(), maxBorrowRateRay: batch.limits.maxBorrowRateRay.toString(),
    deadline: batch.limits.deadline.toString(), freshness: position.freshness, termsHash, movements,
  };
}

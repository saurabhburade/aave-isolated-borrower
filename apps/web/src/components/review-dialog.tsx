'use client';

import type { Asset, BorrowRequest, Market, ReviewPlan, RiskMetrics } from '@/lib/domain';
import { formatAmount, getHealthFactorColor } from '@/lib/utils';
import { ConfirmationDialog } from './confirmation-dialog';
import { AaveTransactionStatus } from './aave-transaction-status';
import { TokenMark } from './token-mark';
import { ProtocolMark } from './protocol-mark';
import type { ApprovalTransaction } from '@/hooks/use-transaction-flow';

export function ReviewDialog({ open, onClose, request, market, assets, plan, estimatedApr, estimatedRisk, canExecute, onExecute, executePhase, executeError, txHash, approvalTransactions }: { open: boolean; onClose: () => void; request: BorrowRequest; market?: Market; assets: Asset[]; plan: ReviewPlan | null; estimatedApr: string | null; estimatedRisk?: RiskMetrics; canExecute: boolean; onExecute: () => void; executePhase: string; executeError: string | null; txHash: string | null; approvalTransactions?: readonly ApprovalTransaction[] }) {
  const pendingNative = executePhase === 'pending-native';
  const unknown = executePhase === 'error' && Boolean(txHash);
  const busy = ['approving', 'preparing', 'signing', 'confirming', 'syncing'].includes(executePhase);
  const debtMovement = plan?.movements.find(movement => movement.direction === 'account-to-owner');
  const debtAsset = debtMovement?.asset ?? assets.find(asset => asset.id === request.debt.assetId || asset.address.toLowerCase() === request.debt.assetId.split('/').at(-1)?.toLowerCase());
  const collateralMovements = plan?.movements.filter(movement => movement.direction === 'owner-to-account');
  const collateralSummary = collateralMovements?.length ? collateralMovements.map(movement => `${formatAmount(movement.amount)} ${movement.asset.symbol}`).join(' + ')
    : request.collaterals.map(input => `${formatAmount(input.amount)} ${assets.find(asset => asset.id === input.assetId || asset.address.toLowerCase() === input.assetId.split('/').at(-1)?.toLowerCase())?.symbol ?? 'Asset'}`).join(' + ');
  const borrowApr = plan ? plan.estimatedBorrowApr : estimatedApr;
  const healthFactor = plan?.riskAfter?.healthFactor ?? estimatedRisk?.healthFactor;
  const reviewMarket = plan?.market ?? market;
  const done = executePhase === 'reverted' || executePhase === 'success' || pendingNative || unknown;
  return <ConfirmationDialog open={open} onClose={onClose} title="Review position"
    description="Review the assets, market and risk before confirming this position."
    busy={busy} done={done}
    actionDisabled={!canExecute} onConfirm={onExecute}
    successAction={plan ? { label: 'View positions', href: `/${plan.market.chainId}/positions` } : undefined}
    status={<AaveTransactionStatus phase={executePhase} error={executeError} hash={txHash} approvalTransactions={approvalTransactions} />}>
      <div className="review-hero"><span>Borrowing</span><div className="review-receive"><TokenMark token={debtAsset?.symbol ?? 'Asset'} icon={debtAsset?.icon} /><strong>{formatAmount(request.debt.amount)} {debtAsset?.symbol}</strong></div></div>
      <dl className="review-metrics aave-reference-metrics">
        <div><dt>Collateral required</dt><dd>{collateralSummary}</dd></div>
        <div><dt>{plan?.riskAfter ? 'Borrow APR' : market?.version === 4 ? 'Base borrow APR estimate' : 'Borrow APR estimate'}</dt><dd>{borrowApr != null ? `${(Number(borrowApr) * 100).toFixed(2)}%` : 'Unavailable'}</dd></div>
        <div><dt>{plan?.riskAfter ? 'Health factor' : 'Health factor estimate'}</dt><dd className={getHealthFactorColor(healthFactor)}>{healthFactor == null ? 'Unknown' : formatAmount(healthFactor, 2)}</dd></div>
        <div><dt>Annual interest estimate</dt><dd>{borrowApr != null ? `${formatAmount(Number(request.debt.amount) * Number(borrowApr))} ${debtAsset?.symbol ?? ''}` : 'Unavailable'}</dd></div>
      </dl>
      {reviewMarket ? <section className="review-route" aria-label="Selected market"><div className="review-route-summary"><ProtocolMark venue={reviewMarket.name} /><span>{reviewMarket.name}</span><strong>V{reviewMarket.version}</strong></div></section> : null}
  </ConfirmationDialog>;
}

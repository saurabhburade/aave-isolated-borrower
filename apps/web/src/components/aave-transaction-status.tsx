'use client';

import { TransactionStatus, type TransactionStep } from './transaction-status';
import type { ApprovalTransaction } from '@/hooks/use-transaction-flow';

const phases: Record<string, { title: string; label: string; state: TransactionStep['state'] }> = {
  preparing: { title: 'Opening wallet', label: 'Connecting', state: 'active' },
  approving: { title: 'Token approval', label: 'Approving', state: 'active' },
  signing: { title: 'Confirm in wallet', label: 'Awaiting signature', state: 'active' },
  confirming: { title: 'Transaction', label: 'Confirming', state: 'active' },
  syncing: { title: 'Transaction', label: 'Confirmed', state: 'done' },
  'pending-native': { title: 'Transaction', label: 'Confirmed', state: 'done' },
  success: { title: 'Position created.', label: 'Completed', state: 'done' },
  reverted: { title: 'Create position', label: 'Failed', state: 'failed' },
  error: { title: 'Transaction interrupted', label: 'Needs attention', state: 'failed' },
};

export function AaveTransactionStatus({ phase, error, hash, approvalTransactions = [], management = false }: { phase: string; error: string | null; hash: string | null; approvalTransactions?: readonly ApprovalTransaction[]; management?: boolean }) {
  if (phase === 'idle') return null;
  const status = phases[phase];
  if (!status) return null;
  const pending = phase === 'pending-native';
  // A receipt lookup failure after submission is not proof that a transaction failed.
  const unknown = phase === 'error' && Boolean(hash);
  const step: TransactionStep = {
    id: 'position', ...status, hash: hash ?? undefined,
    ...(management && phase === 'success' ? { title: 'Position updated.' } : {}),
    ...(management && phase === 'reverted' ? { title: 'Update position' } : {}),
    ...(unknown ? { title: 'Transaction submitted', label: 'Status unknown', state: 'unknown' } : {}),
  };
  const approvalStopped = phase === 'error' && approvalTransactions.some(transaction => transaction.state === 'failed' || transaction.state === 'unknown');
  const steps: TransactionStep[] = [...approvalTransactions];
  if (!approvalStopped && (phase !== 'approving' || !steps.length)) steps.push(step);
  return <TransactionStatus label="Position transaction progress" steps={steps} explorerUrl="https://etherscan.io" warning={pending}
    error={pending ? error ?? 'Transaction confirmed. Position data is still updating. Open Positions to check progress.' : unknown ? `Confirmation is unavailable. Check Positions before retrying. ${error ?? ''}` : error ?? undefined} />;
}

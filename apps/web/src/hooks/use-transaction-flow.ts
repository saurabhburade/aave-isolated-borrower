'use client';

import { useCallback, useRef, useState } from 'react';
import { BaseError } from 'viem';
import { useQueryClient } from '@tanstack/react-query';
import { walletBalancePrefix } from '@/lib/wallet-balances';
import { useAccount, useChainId, usePublicClient, useWalletClient } from 'wagmi';
import type { ReviewPlan } from '@/lib/domain';
import { waitForPositionConfirmation } from '@/lib/position-confirmation';

const erc20Abi = [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }, { type: 'function', name: 'allowance', stateMutability: 'view', inputs: [{ name: 'owner', type: 'address' }, { name: 'spender', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const;
type Phase = 'idle' | 'approving' | 'preparing' | 'signing' | 'confirming' | 'syncing' | 'pending-native' | 'success' | 'reverted' | 'error';

class TransactionRevertedError extends Error {}

export type ApprovalTransaction = { id: string; title: string; hash?: `0x${string}`; state: 'active' | 'done' | 'failed' | 'unknown'; label: string };

export function useTransactionFlow() {
  const queryClient = useQueryClient();
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { address } = useAccount();
  const chainId = useChainId();
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<`0x${string}` | null>(null);
  const [approvalTransactions, setApprovalTransactions] = useState<ApprovalTransaction[]>([]);
  const generation = useRef(0);
  const running = useRef(false);
  const stateTracking = useRef<AbortController | null>(null);

  const execute = useCallback(async (source: ReviewPlan | ((signal: AbortSignal) => Promise<ReviewPlan>), onConfirmed?: (plan: ReviewPlan) => void) => {
    if (running.current) {
      setError('A previous wallet request or transaction is still pending. Complete it before retrying.');
      setPhase('error');
      return;
    }
    running.current = true;
    const current = ++generation.current;
    const cancelled = new Error('Review closed.');
    const assertCurrent = () => { if (current !== generation.current) throw cancelled; };
    setError(null); setHash(null); setApprovalTransactions([]);
    try {
    if (!walletClient || !publicClient || !address) throw new Error('Connect a wallet on the selected network before signing.');
    setPhase('preparing');
    const preparation = new AbortController();
    stateTracking.current = preparation;
    const plan = typeof source === 'function' ? await source(preparation.signal) : source;
    if (stateTracking.current === preparation) stateTracking.current = null;
    assertCurrent();
    if (plan.freshness.status !== 'fresh' || (!plan.request && !plan.managementActions?.length && !plan.riskAfter)) throw new Error('Position data is unavailable or stale. Refresh the review before signing.');
    if (address.toLowerCase() !== plan.owner.toLowerCase()) throw new Error('The connected wallet changed. Re-open review before signing.');
    if (chainId !== plan.market.chainId) throw new Error('The wallet network changed. Switch back and refresh the review.');
    if (Number(plan.deadline) * 1000 <= Date.now()) throw new Error('These terms expired. Refresh the review before signing.');
      const assertLive = async () => {
        assertCurrent();
        const liveAddress = (await walletClient.getAddresses())[0];
        assertCurrent();
        const liveChain = await walletClient.getChainId();
        assertCurrent();
        if (!liveAddress || liveAddress.toLowerCase() !== plan.owner.toLowerCase()) throw new Error('The connected wallet changed. Re-open review before signing.');
        if (liveChain !== plan.market.chainId) throw new Error('The wallet network changed. Switch back and refresh the review.');
        return liveAddress;
      };
      let approvalIndex = 0;
      const submitApproval = async (approval: ReviewPlan['approvals'][number], amount: bigint, reset = false) => {
        const id = `approval-${approvalIndex++}`;
        const update = (changes: Partial<ApprovalTransaction>) => {
          if (current === generation.current) setApprovalTransactions(rows => rows.map(row => row.id === id ? { ...row, ...changes } : row));
        };
        setApprovalTransactions(rows => [...rows, { id, title: `${approval.token.symbol} ${reset ? 'allowance reset' : 'approval'}`, state: 'active', label: 'Awaiting signature' }]);
        let submittedHash: `0x${string}` | undefined;
        let reverted = false;
        try {
          submittedHash = await walletClient.writeContract({ address: approval.token.address, abi: erc20Abi, functionName: 'approve', args: [approval.spender, amount] });
          update({ hash: submittedHash, label: 'Confirming' });
          const receipt = await publicClient.waitForTransactionReceipt({ hash: submittedHash });
          assertCurrent();
          if (receipt.status !== 'success') {
            reverted = true;
            throw new Error(`${reset ? 'Allowance reset' : 'Approval'} for ${approval.token.symbol} reverted.`);
          }
          update({ state: 'done', label: 'Completed' });
        } catch (cause) {
          update({ state: submittedHash && !reverted ? 'unknown' : 'failed', label: submittedHash && !reverted ? 'Status unknown' : 'Failed' });
          throw cause;
        }
      };
      for (const approval of plan.approvals) {
        const liveAddress = await assertLive();
        setPhase('approving');
        const requested = BigInt(approval.amount || '0');
        const allowance = await publicClient.readContract({ address: approval.token.address, abi: erc20Abi, functionName: 'allowance', args: [liveAddress, approval.spender] });
        assertCurrent();
        if (allowance >= requested) continue;
        if (allowance > 0n) {
          await submitApproval(approval, 0n, true);
          await assertLive();
        }
        await submitApproval(approval, requested);
        await assertLive();
      }
      await assertLive();
      setPhase('signing');
      await assertLive();
      if (Number(plan.deadline) * 1000 <= Date.now()) throw new Error('These terms expired. Re-open review before signing.');
      const transactionHash = await walletClient.sendTransaction({ to: plan.transaction.to, data: plan.transaction.data, value: BigInt(plan.transaction.value || '0') });
      if (current === generation.current) {
        setHash(transactionHash);
        setPhase('confirming');
      }
      // A submitted transaction still needs a receipt, even after dismissal.
      const receipt = await publicClient.waitForTransactionReceipt({ hash: transactionHash, confirmations: 1 });
      // Retire confirmed creation intents even when their review was dismissed.
      if (receipt.status === 'success') {
        const queryKey = walletBalancePrefix(plan.market.chainId, plan.owner);
        // Refresh balances in the background; a refresh failure cannot undo receipt success.
        void queryClient.cancelQueries({ queryKey })
          .then(() => queryClient.invalidateQueries({ queryKey }))
          .catch(() => {});
        onConfirmed?.(plan);
      }
      assertCurrent();
      if (receipt.status !== 'success') throw new TransactionRevertedError('The transaction reverted. Your position was not changed.');
      // Creation is complete when its transaction succeeds; portfolio reads are independent.
      if (plan.request) {
        setPhase('success');
        return transactionHash;
      }
      setPhase('syncing');
      const tracking = new AbortController();
      stateTracking.current = tracking;
      const positionReady = await waitForPositionConfirmation(plan, receipt.blockNumber, { signal: tracking.signal });
      if (stateTracking.current === tracking) stateTracking.current = null;
      // Dismissal must not let a completed background read overwrite a new review.
      if (current !== generation.current) return transactionHash;
      if (!positionReady) {
        setPhase('pending-native');
        setError('Transaction confirmed. Position data is still updating. Open Positions to check progress.');
        return transactionHash;
      }
      setPhase('success');
      return transactionHash;
    } catch (cause) {
      if (cause === cancelled || current !== generation.current) return;
      const message = cause instanceof BaseError ? cause.shortMessage : cause instanceof Error ? cause.message : 'Wallet execution failed.';
      if (current === generation.current) { setError(message.slice(0, 300)); setPhase(cause instanceof TransactionRevertedError ? 'reverted' : 'error'); }
      throw cause;
    } finally {
      running.current = false;
    }
  }, [address, chainId, publicClient, walletClient, queryClient]);

  const reset = useCallback(() => { generation.current += 1; stateTracking.current?.abort(); stateTracking.current = null; setPhase('idle'); setError(null); setHash(null); setApprovalTransactions([]); }, []);
  return { phase, error, hash, approvalTransactions, execute, reset };
}

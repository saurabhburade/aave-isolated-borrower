import type { Position, ReviewPlan } from './domain.ts';

type Options = { signal?: AbortSignal; timeoutMs?: number; pollIntervalMs?: number; fetcher?: typeof fetch };

/** Wait for a fresh native read at or after the successful receipt's block. */
export async function waitForPositionConfirmation(
  plan: Pick<ReviewPlan, 'account' | 'owner' | 'market'>,
  confirmedBlock: bigint,
  { signal, timeoutMs = 60_000, pollIntervalMs = 1_500, fetcher = fetch }: Options = {},
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  const url = `/api/positions/${plan.account}?owner=${encodeURIComponent(plan.owner)}&chainId=${plan.market.chainId}`;
  while (!signal?.aborted && Date.now() < deadline) {
    try {
      const requestTimeout = AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - Date.now())));
      const response = await fetcher(url, { cache: 'no-store', signal: signal ? AbortSignal.any([signal, requestTimeout]) : requestTimeout });
      const body = await response.json() as { position?: Position };
      if (signal?.aborted || Date.now() >= deadline) return false;
      const position = body.position;
      if (response.ok && position?.freshness?.status === 'fresh' && ['open', 'empty', 'closed'].includes(position.status)
        && position.account?.toLowerCase() === plan.account.toLowerCase()
        && position.owner?.toLowerCase() === plan.owner.toLowerCase()
        && position.chainId === plan.market.chainId && position.market?.id === plan.market.id
        && position.freshness.blockNumber !== null && BigInt(position.freshness.blockNumber) >= confirmedBlock) return true;
    } catch {
      // A slow or unavailable read does not undo an already confirmed transaction.
    }
    const delay = Math.min(pollIntervalMs, deadline - Date.now());
    if (signal?.aborted || delay <= 0) break;
    await new Promise<void>(resolve => {
      const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', finish); resolve(); };
      const timer = setTimeout(finish, delay);
      signal?.addEventListener('abort', finish, { once: true });
    });
  }
  return false;
}

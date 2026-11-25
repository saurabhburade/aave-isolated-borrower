import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForPositionConfirmation } from './position-confirmation.ts';
import type { Position, ReviewPlan } from './domain.ts';

const plan: Pick<ReviewPlan, 'account' | 'owner' | 'market'> = {
  account: '0x0000000000000000000000000000000000000011',
  owner: '0x0000000000000000000000000000000000000022',
  market: { id: '31337/v3/pool', chainId: 31337, version: 3, venue: '0x0000000000000000000000000000000000000033', name: 'Pool', network: 'Local', assets: [], status: 'available' },
};
const position = (patch: Partial<Position> = {}) => ({ ...plan, chainId: 31337, status: 'open', freshness: { status: 'fresh', observedAt: '2026-11-26T00:00:00Z', blockNumber: '12' }, ...patch });
const response = (value: unknown) => Response.json({ position: value });

test('waits through unavailable, absent, stale and pre-confirmation state before accepting the position', async () => {
  const replies = [Response.json({}, { status: 503 }), response(null), response(position({ freshness: { status: 'stale', observedAt: null, blockNumber: '12' } })), response(position({ freshness: { status: 'fresh', observedAt: null, blockNumber: '11' } })), response(position({ status: 'unknown' })), response(position())];
  let reads = 0;
  const ready = await waitForPositionConfirmation(plan, 12n, {
    timeoutMs: 500, pollIntervalMs: 1,
    fetcher: async (url, options) => {
      assert.match(String(url), /\/api\/positions\/0x.*\?owner=0x.*&chainId=31337$/);
      assert.equal(options?.cache, 'no-store');
      assert.equal(options?.method, undefined, 'confirmation only reads position state');
      return replies[reads++] ?? Response.json({}, { status: 503 });
    },
  });
  assert.equal(ready, true);
  assert.equal(reads, replies.length);
});

test('does not confirm another owner, account, venue or chain', async () => {
  const replies = [
    position({ owner: plan.account }), position({ account: plan.owner }),
    position({ market: { ...plan.market, id: 'another-market' } }), position({ chainId: 1 }), position(),
  ];
  let reads = 0;
  assert.equal(await waitForPositionConfirmation(plan, 12n, { timeoutMs: 500, pollIntervalMs: 1, fetcher: async () => response(replies[reads++]) }), true);
  assert.equal(reads, replies.length);
});

test('retries transport and malformed-response failures without treating the transaction as reverted', async () => {
  let reads = 0;
  assert.equal(await waitForPositionConfirmation(plan, 12n, { timeoutMs: 500, pollIntervalMs: 1, fetcher: async () => {
    reads++;
    if (reads === 1) throw new TypeError('fetch failed');
    if (reads === 2) return new Response('not JSON');
    return response(position());
  } }), true);
  assert.equal(reads, 3);
});

test('fresh closed positions are valid after management transactions', async () => {
  assert.equal(await waitForPositionConfirmation(plan, 12n, { fetcher: async () => response(position({ status: 'closed' })) }), true);
});

test('stops polling after the bounded wait when position state stays unavailable', async () => {
  let reads = 0;
  assert.equal(await waitForPositionConfirmation(plan, 12n, { timeoutMs: 40, pollIntervalMs: 5, fetcher: async () => { reads++; return response(null); } }), false);
  assert(reads > 1, 'a single delayed read must not stop confirmation');
});

test('cancellation aborts an in-flight read and stops polling', async () => {
  const controller = new AbortController();
  const cancel = setTimeout(() => controller.abort(), 5);
  let reads = 0;
  try {
    assert.equal(await waitForPositionConfirmation(plan, 12n, { signal: controller.signal, fetcher: async (_url, options) => {
      reads++;
      return new Promise<Response>((_resolve, reject) => options!.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }));
    } }), false);
  } finally { clearTimeout(cancel); }
  assert.equal(reads, 1);
});

test('a completed response cannot mark a dismissed review successful', async () => {
  const controller = new AbortController();
  assert.equal(await waitForPositionConfirmation(plan, 12n, { signal: controller.signal, fetcher: async () => {
    controller.abort();
    return response(position());
  } }), false);
});

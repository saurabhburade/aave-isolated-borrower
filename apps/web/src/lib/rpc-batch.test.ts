import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { mapRpc } from './rpc-batch.ts';

test('reserve reads preserve input order and bound concurrency', async () => {
  let active = 0;
  let peak = 0;
  const result = await mapRpc([0, 1, 2, 3, 4, 5], async value => {
    peak = Math.max(peak, ++active);
    await delay(6 - value);
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [0, 2, 4, 6, 8, 10]);
  assert(peak <= 4);
});

test('a failed reserve read stops scheduling the remaining inventory', async () => {
  const started: number[] = [];
  await assert.rejects(mapRpc(Array.from({ length: 30 }, (_, i) => i), async value => {
    started.push(value);
    if (value === 0) throw new Error('source rate limited');
    await delay(5);
    return value;
  }), /source rate limited/);
  assert.equal(started.length, 4);
});

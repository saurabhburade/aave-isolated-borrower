import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreClock } from './restore-clock.mjs';

function fixture(timestamp, chainId = '0x7a69') {
  const calls = [];
  let next;
  const request = async (method, params) => {
    calls.push({ method, params });
    if (method === 'eth_chainId') return chainId;
    if (method === 'eth_getBlockByNumber') return { timestamp: `0x${timestamp.toString(16)}` };
    if (method === 'evm_setNextBlockTimestamp') { next = params[0]; return next; }
    if (method === 'evm_mine') { timestamp = next; return '0x0'; }
    throw new Error(`Unexpected RPC: ${method}`);
  };
  return { request, calls };
}

test('a restored clock behind reserve updates advances before interest reads', async () => {
  const f = fixture(1795709598);
  assert.equal(await restoreClock(f.request, 1795770695), true);
  assert.deepEqual(f.calls.filter(call => call.method.startsWith('evm_')), [
    { method: 'evm_setNextBlockTimestamp', params: [1795770695] },
    { method: 'evm_mine', params: [] },
  ]);
  assert(BigInt((await f.request('eth_getBlockByNumber', ['latest', false])).timestamp) >= 1795711168n,
    'restored block no longer predates the observed Lido reserve update');
});

for (const timestamp of [2000, 2001]) test(`clock recovery never rewinds an equal or newer block (${timestamp})`, async () => {
  const f = fixture(timestamp);
  assert.equal(await restoreClock(f.request, 2000), false);
  assert(!f.calls.some(call => call.method.startsWith('evm_')));
});

test('clock recovery refuses a non-local chain before mutation', async () => {
  const f = fixture(1000, '0x1');
  await assert.rejects(restoreClock(f.request, 2000), /31337/);
  assert.deepEqual(f.calls.map(call => call.method), ['eth_chainId']);
});

test('clock recovery detects a node that fails to advance', async () => {
  const f = fixture(1000);
  await assert.rejects(restoreClock((method, params) => method === 'evm_mine' ? Promise.resolve('0x0') : f.request(method, params), 2000), /did not advance/);
});

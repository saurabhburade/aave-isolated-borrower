import assert from 'node:assert/strict';
import test from 'node:test';
import type { PublicClient } from 'viem';
import type { CatalogMarket } from './market-catalog.ts';
import { createForkMarketRatesLoader } from './server-fork-market-rates.ts';
const token = '0x0000000000000000000000000000000000000001';
const pool = '0x0000000000000000000000000000000000000002';
const hub = '0x0000000000000000000000000000000000000003';
const market = (version: 3 | 4): CatalogMarket => ({ id: `market${version}`, chainId: 1, version, venue: pool, name: `Aave V${version}`, network: 'Ethereum', isTestnet: false, reserves: [{ address: token, symbol: 'USDC', name: 'USD Coin', decimals: 6, reserveId: version === 4 ? '7' : undefined, canBorrow: true, canSupply: true, canCollateral: false }] });
function fixture() {
  const calls: { functionName: string; blockNumber: bigint; args: readonly unknown[] }[] = [];
  const state = { chainId: 31337, hash: '0x01', failV4: false, variableDebt: token, rate: 46020948791512481612045926n };
  const client = {
    getChainId: async () => state.chainId,
    getBlock: async () => ({ number: 10n, hash: state.hash }),
    readContract: async (input: { functionName: string; blockNumber: bigint; args: readonly bigint[] }) => {
      calls.push(input);
      if (input.functionName === 'getReserveData') {
        const data = Array(15).fill(0n); data[4] = state.rate; data[10] = state.variableDebt;
        return data;
      }
      if (state.failV4) throw new Error('Reserve unavailable');
      if (input.functionName === 'getReserve') return [token, hub, input.args[0], 6];
      if (input.functionName === 'getAssetDrawnRate') return state.rate + input.args[0];
      throw new Error('Unexpected RPC read');
    },
  } as unknown as PublicClient;
  return { calls, state, load: createForkMarketRatesLoader(client) };
}
test('local rates use the executing fork rather than live Ethereum API rates', async () => {
  const f = fixture();
  const result = await f.load([market(3)], token);
  assert.equal(result.rates[0].borrowRateRay, f.state.rate.toString());
  assert.equal(result.rates[0].borrowApy, Math.expm1(Number(f.state.rate) / 1e27).toString());
  assert.deepEqual(f.calls.map(call => call.functionName), ['getReserveData']);
  assert(f.calls.every(call => call.blockNumber === 10n));
  assert.deepEqual(result.errors, []);
});
test('V4 rates bind the selected reserve and Hub; concurrent reads share block-specific results', async () => {
  const f = fixture();
  const selected = market(4);
  selected.reserves.push({ ...selected.reserves[0], reserveId: '9' });
  const [first, second] = await Promise.all([f.load([selected], token), f.load([selected], token)]);
  assert.deepEqual(first, second);
  assert.deepEqual(first.rates.map(rate => rate.reserveId), ['7', '9']);
  assert.deepEqual(first.rates.map(rate => rate.borrowRateRay), [(f.state.rate + 7n).toString(), (f.state.rate + 9n).toString()]);
  assert.equal(f.calls.length, 4);
  await f.load([selected], token);
  assert.equal(f.calls.length, 4);
  f.state.hash = '0x02';
  await f.load([selected], token);
  assert.equal(f.calls.length, 8, 'a newly mined block cannot reuse a previous rate');
});
test('missing fork reserves stay unavailable instead of appearing as zero-cost borrowing', async () => {
  const f = fixture();
  f.state.variableDebt = '0x0000000000000000000000000000000000000000';
  f.state.failV4 = true;
  const result = await f.load([market(3), market(4)], token);
  assert(result.rates.every(rate => rate.borrowApy === null));
  assert.equal(result.errors.length, 2);
});
test('local rate reads reject a different chain and skip empty selections', async () => {
  const f = fixture();
  f.state.chainId = 1;
  assert.deepEqual(await f.load([], token), { rates: [], errors: [] });
  await assert.rejects(f.load([market(3)], token), /31337/);
  assert.equal(f.calls.length, 0);
});

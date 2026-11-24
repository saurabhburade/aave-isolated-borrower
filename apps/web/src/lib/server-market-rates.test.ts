import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogMarket } from './market-catalog.ts';
import { createIndexedMarketRatesLoader } from './server-market-rates.ts';

const token = '0x0000000000000000000000000000000000000001';
const pool = '0x0000000000000000000000000000000000000002';
const market = (id: string, version: 3 | 4): CatalogMarket => ({ id, version, chainId: 1, venue: pool, name: id, network: 'Ethereum', isTestnet: false, reserves: [{ address: token, symbol: 'USDC', name: 'USD Coin', decimals: 6, canBorrow: true, canSupply: true, canCollateral: true, reserveId: version === 4 ? '7' : undefined }] });

const fetcher = (requests: any[], raw = '0.04') => (async (url: any, init: any) => {
  const { query, variables } = JSON.parse(String(init.body));
  requests.push({ url: String(url), query, variables });
  const v3 = String(url).includes('v3');
  return Response.json({ data: Object.fromEntries(Object.entries(variables).map(([key, request]: any) => [key.replace('r', 'q'), v3
    ? { underlyingToken: { address: request.underlyingToken }, borrowInfo: { apy: { value: raw } } }
    : { onChainId: request.query.reserveInput.onChainId, asset: { underlying: { address: token } }, summary: { borrowApy: { value: raw } } }])) });
}) as typeof fetch;

test('batches debt rates only for filtered markets, keeping duplicate V4 reserves distinct and sharing in-flight requests', async () => {
  const requests: any[] = [];
  const bluechip = market('bluechip', 4);
  bluechip.reserves.push({ ...bluechip.reserves[0], reserveId: '4' }, { ...bluechip.reserves[0], address: pool });
  const load = createIndexedMarketRatesLoader(fetcher(requests));
  const selected = [market('v3', 3), bluechip, { ...market('disabled', 4), reserves: [{ ...bluechip.reserves[0], canBorrow: false }] }];
  const [first, second] = await Promise.all([load(selected, token), load(selected, token)]);
  assert.deepEqual(first, second);
  assert.equal(requests.length, 2);
  assert.equal(Object.keys(requests.find(r => r.url.includes('v3')).variables).length, 1);
  assert.equal(Object.keys(requests.find(r => r.url.includes('v4')).variables).length, 2);
  assert.equal(first.rates.length, 3);
  assert.deepEqual(first.rates.filter(r => r.marketId === 'bluechip').map(r => r.reserveId), ['7', '4']);
  assert(first.rates.every(rate => rate.borrowApy === '0.04'));
  await load(selected, token);
  assert.equal(requests.length, 2);
  await load([selected[0]], token);
  assert.equal(requests.length, 3, 'changing the filter has its own rate request');
});

test('zero APY remains valid while missing, negative, empty or incorrectly bound results stay unavailable', async () => {
  for (const raw of ['0', '-1', '', 'NaN']) {
    const load = createIndexedMarketRatesLoader(fetcher([], raw));
    assert.equal((await load([market('v3', 3)], token)).rates[0].borrowApy, raw === '0' ? '0' : null);
  }
  const wrong = createIndexedMarketRatesLoader((async () => Response.json({ data: { q0: { onChainId: '4', asset: { underlying: { address: token } }, summary: { borrowApy: { value: '0.01' } } } } })) as typeof fetch);
  assert.equal((await wrong([market('v4', 4)], token)).rates[0].borrowApy, null);
});

test('provider failures preserve healthy rates and retry; empty filters never call either API', async () => {
  let fail = true;
  const requests: any[] = [];
  const healthy = fetcher(requests);
  const load = createIndexedMarketRatesLoader((async (url, init) => String(url).includes('v4') && fail ? Response.json({ errors: [{ message: 'unavailable' }] }) : healthy(url, init)) as typeof fetch);
  assert.deepEqual(await load([], token), { rates: [], errors: [] });
  assert.equal(requests.length, 0);
  const selected = [market('v3', 3), market('v4', 4)];
  const first = await load(selected, token);
  assert.equal(first.rates.length, 1);
  assert.match(first.errors[0], /V4/);
  fail = false;
  const second = await load(selected, token);
  assert.deepEqual(second.errors, []);
  assert.equal(second.rates.length, 2);
});

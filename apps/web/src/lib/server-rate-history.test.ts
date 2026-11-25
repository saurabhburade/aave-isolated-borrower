import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogMarket } from './market-catalog.ts';
import { createRateHistoryLoader } from './server-rate-history.ts';

const token = '0x0000000000000000000000000000000000000001';
const other = '0x0000000000000000000000000000000000000002';
function market(id: string, version: 3 | 4): CatalogMarket {
  return { id, version, chainId: 1, venue: other, name: id, network: 'Ethereum', isTestnet: false,
    reserves: [{ address: token, symbol: 'DAI', name: 'Dai', decimals: 18, canSupply: true, canBorrow: true, canCollateral: true, reserveId: version === 4 ? '7' : undefined }] };
}
const samples = () => [2, 1, 0].map(days => ({ date: new Date(Date.now() - days * 86400_000 - 3600_000).toISOString(), avgRate: { value: '0.04' } }));
function provider(requests: any[], fail?: string, wrongToken = false): typeof fetch {
  return (async (url: any, init: any) => {
    const { query, variables: { request } } = JSON.parse(String(init.body));
    requests.push({ url: String(url), query, request });
    if (fail && (request.market === fail || request.reserve === fail)) return Response.json({ errors: [{ message: 'Unavailable' }] });
    if (query.includes('ReserveRequest')) return Response.json({ data: { reserve: { id: `reserve-${request.query.reserveInput.onChainId}`, onChainId: request.query.reserveInput.onChainId, asset: { underlying: { address: wrongToken ? other : token } } } } });
    return Response.json({ data: { [String(url).includes('v3') ? 'borrowAPYHistory' : 'borrowApyHistory']: samples() } });
  }) as typeof fetch;
}

test('loads every selected market for a non-USDC loan and keeps V4 reserves distinct', async () => {
  const requests: any[] = [];
  const v4 = market('bluechip', 4);
  v4.reserves.push({ ...v4.reserves[0], reserveId: '4' }, { ...v4.reserves[0], address: other, reserveId: '9' });
  const load = createRateHistoryLoader(provider(requests));
  const selected = [market('core', 3), market('prime', 3), v4, { ...market('disabled', 4), reserves: [{ ...v4.reserves[0], canBorrow: false }] }];
  const [first, second] = await Promise.all([load('7d', selected, token), load('7d', selected, token)]);
  assert.deepEqual(first.series.map(series => series.id), ['core', 'prime', 'bluechip/7', 'bluechip/4']);
  assert(first.series.every(series => series.points.length === 3 && series.detail.includes('DAI')));
  assert.match(first.series[2].label, /Reserve 7/);
  assert.deepEqual(first.series, second.series);
  assert.equal(requests.length, 6, 'concurrent requests share each reserve history');
  assert(requests.filter(request => request.query.includes('BorrowAPYHistoryRequest')).every(({ request }) => request.underlyingToken === token));
  assert.deepEqual(requests.filter(request => request.query.includes('ReserveRequest')).map(({ request }) => request.query.reserveInput.onChainId), ['7', '4']);
  await load('7d', [selected[0]], token);
  assert.equal(requests.length, 6, 'filter changes reuse cached matching market history');
  const empty = await load('7d', [], token);
  assert.deepEqual(empty.series, []);
});

test('history cache separates loan assets and periods; providers get their supported 90-day windows', async () => {
  const requests: any[] = [];
  const load = createRateHistoryLoader(provider(requests));
  const v3 = market('core', 3);
  await load('7d', [v3], token);
  await load('90d', [v3, market('main', 4)], token);
  await load('7d', [{ ...v3, reserves: [{ ...v3.reserves[0], address: other }] }], other);
  assert(requests.some(({ request }) => request.underlyingToken === other));
  assert(requests.some(({ request }) => request.window === 'LAST_SIX_MONTHS'));
  assert(requests.some(({ request }) => request.window === 'LAST_THREE_MONTHS' && request.includeRewards === false));
});

test('one unavailable provider leaves other market lines and an explicit unavailable series', async () => {
  const requests: any[] = [];
  const load = createRateHistoryLoader(provider(requests, 'reserve-7'));
  const result = await load('7d', [market('core', 3), market('main', 4)], token);
  assert.equal(result.series[0].points.length, 3);
  assert.equal(result.series[1].points.length, 0);
  assert.equal(result.series[1].error, 'History unavailable');
  await load('7d', [market('main', 4)], token);
  assert.equal(requests.length, 5, 'failed history is retried rather than cached for five minutes');
});

test('rejects mismatched V4 debt reserve identities before requesting their history', async () => {
  const requests: any[] = [];
  const result = await createRateHistoryLoader(provider(requests, undefined, true))('7d', [market('main', 4)], token);
  assert.equal(result.series[0].error, 'History unavailable');
  assert.equal(requests.length, 1);
});

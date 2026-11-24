import assert from 'node:assert/strict';
import test from 'node:test';
import { catalogAssets, catalogAmountUsd, bindBorrowRequest, comparisonMarkets, comparisonBorrowApy, filterComparisonMarkets, rankComparisonMarkets, type CatalogMarket, type IndexedMarketRate } from './market-catalog.ts';
import { createMarketCatalogLoader } from './server-market-catalog.ts';
import type { Asset, Market } from './domain.ts';

const address = '0x00000000000000000000000000000000000000a1';
const wethAddress = '0x00000000000000000000000000000000000000b1';
const debt: Asset = { id: `31337/${address}`, address, symbol: 'USDC', name: 'USD Coin', decimals: 6 };
const weth: Asset = { id: `31337/${wethAddress}`, address: wethAddress, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 };
const usdcReserve = { ...debt, canSupply: true, canBorrow: true, canCollateral: true, usdPrice: '0.9998' };
const wethReserve = { ...weth, canSupply: true, canBorrow: false, canCollateral: true, usdPrice: '3000' };
const catalog: CatalogMarket = { id: 'catalog/1/3/pool', chainId: 1, version: 3, venue: address, name: 'Aave V3 Ethereum', network: 'Ethereum', isTestnet: false, reserves: [usdcReserve, wethReserve] };
const rate = (marketId: string, borrowApy: string | null, reserveId?: string): IndexedMarketRate => ({ marketId, borrowApy, reserveId, observedAt: '2026-11-25T12:00:00Z' });

test('API markets remain browsable without native discovery, with exact execution bindings when available', () => {
  const native: Market = { id: '31337/3/pool', chainId: 31337, version: 3, venue: address.toUpperCase() as `0x${string}`, name: 'Local Core', network: 'Local', status: 'available', assets: [debt] };
  const otherChain = { ...catalog, id: 'catalog/8453/3/pool', chainId: 8453 };
  const otherVersion = { ...catalog, id: 'catalog/1/4/pool', version: 4 as const };
  const rows = comparisonMarkets([native], [catalog, otherChain, otherVersion], 31337);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].id, catalog.id);
  assert.equal(rows[0].executionMarketId, native.id);
  assert.equal(rows[0].status, 'available');
  assert.equal(rows[1].executionMarketId, `31337/v4/${address}`);
  assert.equal(rows[1].reason, undefined, 'catalog markets can be validated dynamically before native discovery finishes');
  assert.equal(comparisonMarkets([], [{ ...catalog, isTestnet: true }], 31337)[0].executionMarketId, undefined);
  assert.equal(rows[1].status, 'unavailable');
  assert.equal(comparisonMarkets([], [catalog, otherChain], 31337).length, 1);
});

test('filters require exact debt token, every supplied asset, collateral support and selected version', () => {
  const good = { ...catalog, version: 4 as const };
  const paused = { ...catalog, id: 'paused', reserves: [usdcReserve, { ...wethReserve, canSupply: false }] };
  const noCollateral = { ...catalog, id: 'no-collateral', reserves: [usdcReserve, { ...wethReserve, canCollateral: false }] };
  const wrongToken = { ...catalog, id: 'wrong-token', reserves: [{ ...usdcReserve, address: wethAddress }] };
  const noBorrow = { ...catalog, id: 'no-borrow', reserves: [{ ...usdcReserve, canBorrow: false }, wethReserve] };
  const markets = comparisonMarkets([], [good, paused, noCollateral, wrongToken, noBorrow], 31337);
  assert.deepEqual(filterComparisonMarkets(markets, 'all', debt, [{ asset: weth, enabled: true }]).map(m => m.id), [good.id]);
  assert.equal(filterComparisonMarkets(markets, 3, debt, [{ asset: weth, enabled: true }]).length, 0);
  assert.equal(filterComparisonMarkets(markets, 'all', debt, [{ asset: weth, enabled: false }]).length, 2);
  assert.equal(filterComparisonMarkets(markets, 'all', debt, [{ asset: undefined, enabled: true }]).length, 0);
});

test('pickers deduplicate tokens and respect borrowing and collateral eligibility on the selected chain', () => {
  const foreign = { ...catalog, chainId: 8453, reserves: [{ ...usdcReserve, address: '0xforeign' }] };
  assert.equal(catalogAssets([catalog, catalog, foreign], 31337).length, 2);
  assert.deepEqual(catalogAssets([catalog], 31337, 'debt').map(a => a.symbol), ['USDC']);
  assert.equal(catalogAssets([{ ...catalog, reserves: [{ ...wethReserve, canCollateral: false }] }], 31337, 'collateral').length, 0);
});

test('lowest valid API APY ranks first, including zero; missing and invalid rates sort last', () => {
  const catalogs = ['high', 'missing', 'negative', 'zero', 'nan'].map(id => ({ ...catalog, id, name: id }));
  const rows = comparisonMarkets([], catalogs, 31337);
  const rates = [rate('high', '0.05'), rate('negative', '-1'), rate('zero', '0'), rate('nan', 'NaN')];
  const ranked = rankComparisonMarkets(rows, debt, rates);
  assert.deepEqual(ranked.slice(0, 2).map(m => m.id), ['zero', 'high']);
  assert.equal(comparisonBorrowApy(ranked[0], debt, rates), '0');
  assert.equal(comparisonBorrowApy(ranked[0], weth, rates), null);
  assert.equal(comparisonBorrowApy(ranked[0], debt, [rate('zero', '')]), null);
});

test('a locally pinned Core USDC reserve never ranks using the cheaper Prime USDC reserve', () => {
  const bluechip = { ...catalog, version: 4 as const, reserves: [{ ...usdcReserve, reserveId: '4' }, { ...usdcReserve, reserveId: '7' }] };
  const rows = comparisonMarkets([], [bluechip], 31337);
  const rates = [rate(bluechip.id, '0.02', '4'), rate(bluechip.id, '0.04', '7')];
  assert.equal(comparisonBorrowApy(rows[0], debt, rates), '0.02');
  assert.equal(comparisonBorrowApy({ ...rows[0], preferredDebtReserveIds: ['7'] }, debt, rates), '0.04');
  assert.equal(comparisonBorrowApy({ ...rows[0], preferredDebtReserveIds: ['9'] }, debt, rates), null);
});

test('USD amounts use API oracle prices without wallet or position simulation and never assume stablecoin parity', () => {
  assert.equal(catalogAmountUsd([catalog], 31337, debt, '6'), 5.9988);
  assert.equal(catalogAmountUsd([catalog], 31337, weth, '2'), 6000);
  assert.equal(catalogAmountUsd([{ ...catalog, chainId: 8453 }], 31337, debt, '6'), null);
  assert.equal(catalogAmountUsd([catalog], 31337, debt, '1..2'), null);
  assert.equal(catalogAmountUsd([{ ...catalog, reserves: [{ ...usdcReserve, usdPrice: '0' }] }], 31337, debt, '6'), null);
});

test('catalog fetches only the selected chain, maps eligibility, and shares concurrent cached requests', async () => {
  const requests: { version: number; query: string; variables: any }[] = [];
  const fetcher = (async (url, init) => {
    const version = String(url).includes('v3') ? 3 : 4;
    const { query, variables } = JSON.parse(String(init?.body));
    requests.push({ version, query, variables });
    const chain = { chainId: 1, name: 'Ethereum', isTestnet: false };
    assert.deepEqual(variables.request.chainIds ?? variables.request.query.chainIds, [1]);
    if (version === 3) return Response.json({ data: { markets: [{ name: 'AaveV3Ethereum', address, chain, reserves: [{ underlyingToken: { ...debt, imageUrl: 'https://images.aave.com/usdc.svg' }, usdExchangeRate: '0.9998', isPaused: false, isFrozen: false, supplyInfo: { canBeCollateral: true, supplyCapReached: false }, borrowInfo: { borrowingState: 'ENABLED', borrowCapReached: false } }] }] } });
    return Response.json({ data: { spokes: [{ id: 'main', name: 'Main', displayName: 'Main', address, chain }, { id: 'empty', name: 'Empty', displayName: 'Empty', address: wethAddress, chain }], reserves: [{ onChainId: '7', spoke: { id: 'main' }, asset: { underlying: { address, info: debt } }, canBorrow: true, canSupply: true, canUseAsCollateral: false, oracle: { price: { value: '0.9999' } } }] } });
  }) as typeof fetch;
  const load = createMarketCatalogLoader(fetcher);
  const [first, second] = await Promise.all([load(1), load(1)]);
  assert.deepEqual(first, second);
  assert.equal(requests.length, 2);
  assert.equal(first.markets.length, 3);
  assert.deepEqual(first.errors, []);
  assert.equal(first.markets.find(m => m.name.endsWith('Empty'))?.reserves.length, 0);
  assert.equal(first.markets.find(m => m.version === 3)?.reserves[0].canBorrow, true);
  assert.equal(first.markets.find(m => m.name.endsWith('Main'))?.reserves[0].canCollateral, false);
  assert(requests.every(request => !request.query.includes('borrowApy') && !request.query.includes('apy {')));
  await load(1);
  assert.equal(requests.length, 2);
});

test('a failed API does not hide healthy markets and is retried', async () => {
  let fail = true;
  const fetcher = (async (url) => {
    if (String(url).includes('v4') && fail) return Response.json({ errors: [{ message: 'Temporarily unavailable' }] });
    if (String(url).includes('v4')) return Response.json({ data: { spokes: [], reserves: [] } });
    return Response.json({ data: { markets: [{ name: 'Ethereum', address, chain: { chainId: 1, name: 'Ethereum', isTestnet: false }, reserves: [] }] } });
  }) as typeof fetch;
  const load = createMarketCatalogLoader(fetcher);
  const first = await load();
  assert.equal(first.markets.length, 1);
  assert.match(first.errors[0], /V4/);
  fail = false;
  assert.deepEqual((await load()).errors, []);
});


test('dynamic multi-Hub debt binds execution to the exact reserve used for the displayed rate', () => {
  const spoke = { ...catalog, version: 4 as const, id: 'dynamic-spoke', reserves: [{ ...usdcReserve, reserveId: '4' }, { ...usdcReserve, reserveId: '7' }] };
  const [market] = comparisonMarkets([], [spoke], 31337);
  const request = { chainId: 31337, collaterals: [{ assetId: weth.id, amount: '1', enabled: true }], debt: { assetId: debt.id, amount: '4' } };
  const rates = [rate(spoke.id, '0.06', '4'), rate(spoke.id, '0.03', '7')];
  const bound = bindBorrowRequest(request, market, debt, rates)!;
  assert.equal(bound.debt.assetId, `${market.executionMarketId}/7/${address}`);
  assert.equal(comparisonBorrowApy(market, debt, rates), '0.03');
  assert.equal(request.debt.assetId, debt.id, 'form identity stays independent of the selected venue');
  assert.deepEqual(bound.collaterals, request.collaterals);
  assert.equal(bindBorrowRequest(request, market, debt, []), request, 'unknown ambiguous reserves are not guessed');
});

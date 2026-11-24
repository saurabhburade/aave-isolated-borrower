import assert from 'node:assert/strict';
import test from 'node:test';
import { comparisonMarkets, estimateMarketRisk, type CatalogMarket } from './market-catalog.ts';
import type { Asset } from './domain.ts';

const debt: Asset = { id: 'usdc', address: '0x0000000000000000000000000000000000000001', symbol: 'USDC', name: 'USDC', decimals: 6 };
const collateral: Asset = { ...debt, id: 'weth', address: '0x0000000000000000000000000000000000000002', symbol: 'WETH', decimals: 18 };
const catalog: CatalogMarket = { id: 'main', chainId: 1, version: 3, venue: debt.address, name: 'Aave', network: 'Ethereum', isTestnet: false, reserves: [
  { ...debt, canSupply: true, canBorrow: true, canCollateral: false, usdPrice: '1' },
  { ...collateral, canSupply: true, canBorrow: false, canCollateral: true, usdPrice: '3000', maxLtv: '0.75', liquidationThreshold: '0.8' },
] };
const row = (market = catalog) => comparisonMarkets([], [market], 31337)[0];
const inputs = [{ asset: collateral, amount: '2', enabled: true }];

test('walletless risk uses entered USD values and standard market parameters, with max LTV separate from actual LTV', () => {
  const risk = estimateMarketRisk(row(), inputs, debt, '3000', []);
  assert.equal(risk.collateralUsd, '6000');
  assert.equal(risk.debtUsd, '3000');
  assert.equal(risk.ltv, '0.5');
  assert.equal(risk.maxLtv, '0.75');
  assert.equal(risk.healthFactor, '1.6');
  assert.equal(risk.borrowCapacityUsd, '1500');
  const v4 = row({ ...catalog, version: 4, reserves: [catalog.reserves[0], { ...catalog.reserves[1], maxLtv: '0.7', liquidationThreshold: '0.7' }] });
  assert.equal(estimateMarketRisk(v4, inputs, debt, '3000', []).healthFactor, '1.4');
});

test('max LTV is available before amounts; absent amounts or prices never become a zero health factor', () => {
  const empty = estimateMarketRisk(row(), [{ ...inputs[0], amount: '' }], debt, '', []);
  assert.equal(empty.maxLtv, '0.75');
  assert.equal(empty.ltv, null);
  assert.equal(empty.healthFactor, null);
  const noPrice = row({ ...catalog, reserves: [catalog.reserves[0], { ...catalog.reserves[1], usdPrice: null }] });
  assert.equal(estimateMarketRisk(noPrice, inputs, debt, '3000', []).healthFactor, null);
  const noThreshold = row({ ...catalog, reserves: [catalog.reserves[0], { ...catalog.reserves[1], liquidationThreshold: null }] });
  const risk = estimateMarketRisk(noThreshold, inputs, debt, '3000', []);
  assert.equal(risk.ltv, '0.5');
  assert.equal(risk.healthFactor, null);
});

test('multiple collateral values weight their own factors, excluding disabled collateral without partial estimates', () => {
  const second: Asset = { ...collateral, id: 'wsteth', address: '0x0000000000000000000000000000000000000003' };
  const market = row({ ...catalog, reserves: [...catalog.reserves, { ...catalog.reserves[1], ...second, usdPrice: '4000', maxLtv: '0.6', liquidationThreshold: '0.7' }] });
  const mixed = [...inputs, { asset: second, amount: '1', enabled: true }];
  const risk = estimateMarketRisk(market, mixed, debt, '5000', []);
  assert.equal(risk.collateralUsd, '10000');
  assert.equal(risk.maxLtv, '0.69');
  assert.equal(risk.healthFactor, '1.52');
  assert.equal(estimateMarketRisk(market, [...inputs, { asset: second, amount: '', enabled: false }], debt, '3000', []).healthFactor, '1.6');
  assert.equal(estimateMarketRisk(market, [...inputs, { asset: second, amount: '', enabled: true }], debt, '3000', []).ltv, null);
});

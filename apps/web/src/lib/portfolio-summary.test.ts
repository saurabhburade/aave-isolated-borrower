import test from 'node:test';
import assert from 'node:assert/strict';
import type { Position } from './domain.ts';
import { hasPositionBalance, portfolioSummary, positionBorrowApy } from './portfolio-summary.ts';

const position = (debt: string, health: string | null, apy = '0.04'): Position => ({
  id: debt, chainId: 31337, account: '0x1', owner: '0x2', salt: '0x0',
  market: { id: 'market', chainId: 31337, version: 3, venue: '0x3', name: 'Aave', network: 'Anvil', assets: [], status: 'available' },
  freshness: { status: 'fresh', observedAt: null, blockNumber: '1' },
  collaterals: [], debts: Number(debt) > 0 ? [{ asset: { id: 'usdc', address: '0x4', symbol: 'USDC', name: 'USD Coin', decimals: 6 }, amount: debt, collateralEnabled: false, apy }] : [],
  risk: { debtUsd: debt, collateralUsd: '1000', healthFactor: health, ltv: null, borrowCapacityUsd: null },
  activity: [], status: 'open',
});

test('positions with collateral remain visible after repayment; empty accounts are hidden', () => {
  const supplied = position('0', null);
  supplied.collaterals = [{ asset: position('1', '2').debts[0].asset, amount: '0.000000000000000001', collateralEnabled: true }];
  supplied.status = 'closed';
  assert.equal(hasPositionBalance(supplied), true);
  supplied.collaterals[0].amount = '0';
  assert.equal(hasPositionBalance(supplied), false);
  assert.equal(hasPositionBalance(position('1', '2')), true, 'outstanding debt remains visible');
  supplied.status = 'unknown';
  assert.equal(hasPositionBalance(supplied), true, 'unavailable balances must not hide an account');
});

test('portfolio health and APY use USD debt weights and ignore debt-free accounts', () => {
  const totals = portfolioSummary([position('100', '2', '0.02'), position('300', '4', '0.06'), position('0', null)], true);
  assert.equal(totals.debtUsd, 400);
  assert.equal(totals.collateralUsd, 3000);
  assert.equal(totals.health, 3.5);
  assert.equal(totals.apy, 0.05);
});

test('empty portfolios have zero known exposure and no invented health or APY', () => {
  assert.deepEqual(portfolioSummary([], true), { debtUsd: 0, collateralUsd: 0, health: null, apy: null });
  assert.deepEqual(portfolioSummary([], false), { debtUsd: null, collateralUsd: null, health: null, apy: null });
});

test('missing and stale native values never become a zero or a partial total', () => {
  const missing = position('100', null);
  missing.risk.collateralUsd = null;
  assert.deepEqual(portfolioSummary([missing], true), { debtUsd: 100, collateralUsd: null, health: null, apy: 0.04 });
  missing.freshness.status = 'stale';
  assert.deepEqual(portfolioSummary([missing], true), { debtUsd: null, collateralUsd: null, health: null, apy: null });
  assert.equal(positionBorrowApy(missing), null);
});

test('different debt assets are not weighted by incomparable token amounts', () => {
  const mixed = position('100', '2');
  mixed.debts.push({ ...mixed.debts[0], asset: { ...mixed.debts[0].asset, id: 'weth', symbol: 'WETH' }, amount: '0.01', apy: '0.08' });
  assert.equal(positionBorrowApy(mixed), null);
  assert.equal(portfolioSummary([mixed], true).apy, null);
  mixed.debts[1].apy = '0.04';
  assert.equal(positionBorrowApy(mixed), 0.04);
});

test('invalid numeric risk data remains unknown', () => {
  const invalid = position('NaN', 'Infinity');
  assert.deepEqual(portfolioSummary([invalid], true), { debtUsd: null, collateralUsd: 1000, health: null, apy: null });
});

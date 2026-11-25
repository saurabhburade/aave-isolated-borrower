import test from 'node:test';
import assert from 'node:assert/strict';
import { parseUnits } from 'viem';
import type { Balance, Freshness } from './domain.ts';
import { fullRepaymentFunding, maximumRepayment } from './repayment.ts';
const now = Date.parse('2026-11-27T12:00:00Z');
const fresh: Freshness = { status: 'fresh', observedAt: new Date(now).toISOString(), blockNumber: '1' };
const debt: Balance = { asset: { id: 'usdt', address: '0x1', symbol: 'USDT', name: 'Tether', decimals: 6 }, amount: '499.004545', apy: '0.05', collateralEnabled: false };

test('Max uses the wallet balance for an unfunded full repayment and explains what remains', () => {
  const max = maximumRepayment(debt, fresh, parseUnits('499', 6), now)!;
  assert.equal(max.amount, '499');
  assert.equal(max.fullRepayment, false);
  assert.match(max.warning!, /Not enough USDT.*interest buffer.*499 USDT.*collateral will stay supplied/);
});
test('a funded Max caps the amount at debt and includes the buffer in the funding threshold', () => {
  const required = fullRepaymentFunding(debt, fresh, now);
  assert(required > parseUnits(debt.amount, 6));
  const max = maximumRepayment(debt, fresh, required, now)!;
  assert.equal(max.amount, debt.amount);
  assert.equal(max.fullRepayment, true);
  assert.equal(max.warning, null);
  assert.equal(maximumRepayment(debt, fresh, required - 1n, now)!.fullRepayment, false);
  assert.equal(maximumRepayment(debt, fresh, parseUnits('1000', 6), now)!.amount, debt.amount);
});
test('unknown balances are not treated as zero; tiny balances retain full token precision', () => {
  assert.equal(maximumRepayment(debt, fresh, undefined, now), null);
  assert.equal(maximumRepayment(debt, fresh, 0n, now)!.amount, '0');
  assert.equal(maximumRepayment(debt, fresh, 1n, now)!.amount, '0.000001');
});

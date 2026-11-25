import test from 'node:test';
import assert from 'node:assert/strict';
import type { Asset, Position } from './domain.ts';
import { managementWarning } from './management-policy.ts';

const asset: Asset = { id: 'weth', address: '0x1', symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 };
const other: Asset = { ...asset, id: 'usdc', address: '0x2', symbol: 'USDC' };
const position: Position = {
  id: 'position', chainId: 31337, account: '0x3', owner: '0x4', salt: '0x0',
  market: { id: 'market', chainId: 31337, version: 3, venue: '0x5', name: 'Aave', network: 'Anvil', assets: [asset, other], status: 'available' },
  collaterals: [{ asset, amount: '1', collateralEnabled: true }],
  debts: [{ asset: other, amount: '100', collateralEnabled: false }],
  risk: { healthFactor: '2', collateralUsd: '1000', debtUsd: '100', ltv: '0.1', borrowCapacityUsd: null },
  freshness: { status: 'fresh', observedAt: null, blockNumber: '1' }, activity: [], status: 'open',
};
const options = { position, asset, fullRepayment: false, useMax: false };

test('full repayment explains the collateral return; partial repayment does not', () => {
  assert.equal(managementWarning({ ...options, kind: 'repay' }), null);
  assert.equal(managementWarning({ ...options, kind: 'repay', fullRepayment: true }), "You're repaying the full debt and withdrawing all collateral in one transaction.");
  const multipleDebts = { ...position, debts: [...position.debts, { ...position.debts[0], asset }] };
  assert.match(managementWarning({ ...options, position: multipleDebts, kind: 'repay', fullRepayment: true })!, /Other debts.*remain open/);
});

test('only adding a second distinct collateral token warns about cross margin', () => {
  assert.match(managementWarning({ ...options, kind: 'supply', asset: other })!, /cross-margin/);
  assert.equal(managementWarning({ ...options, kind: 'supply' }), null);
  const empty = { ...position, collaterals: [{ ...position.collaterals[0], amount: '0' }] };
  assert.equal(managementWarning({ ...options, kind: 'supply', position: empty, asset: other }), null);
  const disabled = { ...position, collaterals: [{ ...position.collaterals[0], collateralEnabled: false }] };
  assert.equal(managementWarning({ ...options, kind: 'supply', position: disabled, asset: other }), null);
});

test('Max supply and withdrawals explain the action and minimum health factor', () => {
  assert.match(managementWarning({ ...options, kind: 'supply', useMax: true })!, /full WETH wallet balance/);
  assert.match(managementWarning({ ...options, kind: 'withdraw' })!, /at or above 1.06/);
  assert.match(managementWarning({ ...options, kind: 'withdraw', useMax: true })!, /removing all supplied WETH.*1.06/);
});

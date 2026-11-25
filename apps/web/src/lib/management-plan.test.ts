import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, maxUint256, parseUnits } from 'viem';
import type { Position } from './domain.ts';
import { accountAbi } from './abis.ts';
import { buildPositionManagementPlan } from './management-plan.ts';
const now = Date.parse('2026-11-27T12:00:00Z');
const token = (id: string, last: string, decimals = 18, reserveId?: string) => ({ id, address: `0x${last.padStart(40, '0')}` as const, symbol: id, name: id, decimals, reserveId });
const weth = token('WETH', '1', 18, '7');
const usdc = token('USDC', '2', 6, '9');
const fixture = (version: 3 | 4): Position => ({
  id: 'position', chainId: 31337, account: '0x0000000000000000000000000000000000000003', owner: '0x0000000000000000000000000000000000000004', salt: `0x${'0'.repeat(64)}`,
  market: { id: 'market', chainId: 31337, version, venue: '0x0000000000000000000000000000000000000005', name: 'Aave', network: 'Anvil', assets: [weth, usdc], status: 'available' },
  collaterals: [{ asset: weth, amount: '1', collateralEnabled: true }],
  debts: [{ asset: usdc, amount: '499.004422', collateralEnabled: false, apy: Math.expm1(0.05).toString() }],
  risk: { healthFactor: '3.45', debtUsd: '499', collateralUsd: '2095', ltv: '0.2', borrowCapacityUsd: null },
  freshness: { status: 'fresh', observedAt: new Date(now).toISOString(), blockNumber: '123' }, activity: [], status: 'open',
});
for (const version of [3, 4] as const) {
  test(`V${version}: Max withdrawal encodes directly from a debt-free position`, () => {
    const position = { ...fixture(version), debts: [] };
    const plan = buildPositionManagementPlan(position, { kind: 'withdraw', assetId: weth.id, amount: maxUint256.toString() }, now);
    const decoded = decodeFunctionData({ abi: accountAbi, data: plan.transaction.data });
    assert.equal(decoded.functionName, 'execute');
    assert.deepEqual(decoded.args[0], []);
    assert.equal(decoded.args[1][0][0], 1);
    assert.equal(decoded.args[1][0][3], maxUint256);
    assert.equal(decoded.args[2][1], 1060000000000000000n);
    assert.equal(plan.riskAfter, null);
    assert.equal(plan.simulatedAtBlock, undefined);
    assert.deepEqual(plan.approvals, []);
  });
  test(`V${version}: full repayment funds bounded interest, repays first, and returns all collateral`, () => {
    const position = fixture(version);
    const plan = buildPositionManagementPlan(position, { kind: 'close', assetId: usdc.id }, now);
    const decoded = decodeFunctionData({ abi: accountAbi, data: plan.transaction.data });
    assert.equal(decoded.functionName, 'execute');
    const { args } = decoded;
    assert.deepEqual(args[1].map(action => action[0]), [3, 1]);
    assert(args[1].every(action => action[3] === maxUint256));
    assert(BigInt(plan.approvals[0].amount) > parseUnits(position.debts[0].amount, 6));
    assert(BigInt(plan.approvals[0].amount) < parseUnits('500', 6));
    assert.equal(plan.approvals[0].spender, position.account);
    assert.equal(plan.movements[1].direction, 'account-to-owner');
    assert.equal(plan.movements[1].amount, '1');
    assert.equal(args[1][0][2], 9n);
    assert.equal(args[1][1][2], 7n);
  });
}
test('partial repayment and supply preserve precise amounts without requesting a backend plan', () => {
  const position = fixture(4);
  const repay = buildPositionManagementPlan(position, { kind: 'repay', assetId: usdc.id, amount: '1.000001' }, now);
  assert.equal(repay.approvals[0].amount, '1000001');
  const supply = buildPositionManagementPlan(position, { kind: 'supply', assetId: weth.id, amount: '0.1', enabled: true }, now);
  const decoded = decodeFunctionData({ abi: accountAbi, data: supply.transaction.data });
  assert.equal(decoded.functionName, 'execute');
  const { args } = decoded;
  assert.equal(args[1][0][0], 0);
  assert.equal(args[1][0][3], parseUnits('0.1', 18));
  assert.equal(args[1][0][4], true);
  assert.equal(supply.transaction.to, position.account);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeFunctionData } from 'viem';
import type { Address, BorrowRequest, CreationDeployment, Freshness } from './domain.ts';
import type { ComparisonMarket } from './market-catalog.ts';
import { factoryAbi } from './abis.ts';
import { buildSelectedMarketPlan, predictPositionAddress } from './creation-plan.ts';
const owner = '0x0000000000000000000000000000000000000001';
const venue = '0x0000000000000000000000000000000000000002';
const collateralAddress = '0x0000000000000000000000000000000000000003';
const debtAddress = '0x0000000000000000000000000000000000000004';
const deployment: CreationDeployment = { factory: '0x0000000000000000000000000000000000000005', accountCreationCode: '0x6001' };
const salt = `0x${'42'.repeat(32)}` as const;
const freshness: Freshness = { status: 'fresh', observedAt: '2026-11-27T12:00:00Z', blockNumber: '100' };
const now = Date.parse(freshness.observedAt!);
function fixture(version: 3 | 4) {
  const id = `31337/v${version}/${venue}`;
  const collateral = { address: collateralAddress, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, reserveId: version === 4 ? '2' : undefined, canSupply: true, canBorrow: false, canCollateral: true, collateralRiskBps: '2500' };
  const debt = { ...collateral, address: debtAddress, symbol: 'USDC', decimals: 6, reserveId: version === 4 ? '7' : undefined, canBorrow: true, canCollateral: false };
  const market: ComparisonMarket = { id: 'catalog', executionMarketId: id, chainId: 31337, version, venue, name: 'Selected market', network: 'Anvil', assets: [], status: 'unchecked', catalog: { id: 'catalog', chainId: 1, version, venue, name: 'Selected market', network: 'Ethereum', isTestnet: false, reserves: [collateral, debt] } };
  const request: BorrowRequest = { chainId: 31337, collaterals: [{ assetId: `31337/${collateralAddress}`, amount: '1.25', enabled: true }], debt: { assetId: version === 4 ? `${id}/7/${debtAddress}` : `31337/${debtAddress}`, amount: '499.000001' } };
  return { deployment, market, request, owner: owner as Address, salt, borrowApr: '0.04', freshness, now };
}
for (const version of [3, 4] as const) test(`V${version}: creation uses loaded reserves, precise funding, and a locally predicted approval address`, () => {
  const input = fixture(version);
  const plan = buildSelectedMarketPlan(input);
  const decoded = decodeFunctionData({ abi: factoryAbi, data: plan.transaction.data });
  assert.equal(decoded.functionName, 'createPosition');
  assert.equal(decoded.args[0], version);
  assert.equal(decoded.args[1].toLowerCase(), venue);
  assert.equal(decoded.args[2], salt);
  assert.equal(decoded.args[3][0].amount, 1250000000000000000n);
  assert.deepEqual(decoded.args[4].map(action => action.kind), version === 4 ? [0, 4, 5, 2] : [0, 4, 2]);
  assert.equal(decoded.args[4].at(-1)!.amount, 499000001n);
  assert.equal(decoded.args[5].minHealthFactor, 1_050_000_000_000_000_000n);
  assert.equal(plan.minHealthFactor, '1050000000000000000');
  assert.equal(plan.transaction.to, deployment.factory);
  assert.equal(plan.approvals[0].spender, plan.account);
  assert.equal(plan.account, predictPositionAddress(deployment, input.market, owner, salt));
  assert.equal(plan.approvals[0].amount, '1250000000000000000');
  assert.equal(plan.simulatedAtBlock, undefined);
  assert.equal(plan.riskAfter, null);
  assert.equal(plan.freshness, freshness);
  if (version === 4) {
    assert.equal(decoded.args[4][0].reserveId, 2n);
    assert.equal(decoded.args[4].at(-1)!.reserveId, 7n);
    assert(BigInt(plan.maxBorrowRateRay) >= 52500000000000000000000000n, 'rate limit includes the selected collateral risk premium');
  }
});
test('V4 executes the exact displayed debt reserve when a token exists in two Hubs', () => {
  const input = fixture(4);
  input.market.catalog!.reserves.push({ ...input.market.catalog!.reserves[1], reserveId: '9' });
  const plan = buildSelectedMarketPlan(input);
  const decoded = decodeFunctionData({ abi: factoryAbi, data: plan.transaction.data });
  assert.equal(decoded.functionName, 'createPosition');
  assert.equal(decoded.args[4].at(-1)!.reserveId, 7n);
  input.request.debt.assetId = `31337/${debtAddress}`;
  assert.throws(() => buildSelectedMarketPlan(input), /unambiguous/);
});
test('position addresses bind owner, venue, version, chain, and intent independently of amounts', () => {
  const input = fixture(3);
  const original = predictPositionAddress(deployment, input.market, owner, salt);
  for (const market of [{ ...input.market, venue: collateralAddress as Address }, { ...input.market, version: 4 as const }, { ...input.market, chainId: 1 }]) assert.notEqual(predictPositionAddress(deployment, market, owner, salt), original);
  assert.notEqual(predictPositionAddress(deployment, input.market, debtAddress, salt), original);
  assert.notEqual(predictPositionAddress(deployment, input.market, owner, `0x${'43'.repeat(32)}`), original);
});
test('missing selected-market risk data does not silently remove the V4 rate bound', () => {
  const input = fixture(4);
  input.market.catalog!.reserves[0].collateralRiskBps = null;
  assert.throws(() => buildSelectedMarketPlan(input), /Collateral risk data/);
});

test('the cached fork rate, rather than an unrelated API estimate, sets the transaction rate limit', () => {
  const input = fixture(3);
  const actual = 46020948791512481612045926n;
  const plan = buildSelectedMarketPlan({ ...input, borrowApr: '0.0404691106640651', borrowRateRay: actual.toString() });
  assert(BigInt(plan.maxBorrowRateRay) >= actual, 'the previous API-derived 4.25% limit rejected this 4.60% fork rate');
  assert.equal(BigInt(plan.maxBorrowRateRay), actual + actual / 20n + 1n);
});

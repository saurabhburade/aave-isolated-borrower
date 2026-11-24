import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeFunctionData, encodeErrorResult, parseAbi, type PublicClient } from 'viem';
import { quoteDiscovery, buildReviewPlan } from './execution.ts';
import { factoryAbi } from './abis.ts';
import type { Discovery, MarketDiscovery } from './discovery.ts';

const owner = '0x0000000000000000000000000000000000001234';
const factory = '0x0000000000000000000000000000000000005678';
const salt = `0x${'ab'.repeat(32)}` as const;

function fixture(version: 3 | 4, balance = 0n) {
  const collateral = { id: 'collateral', address: '0x0000000000000000000000000000000000000001' as const, symbol: 'WETH', name: 'Wrapped Ether', decimals: 18, reserveId: '0' };
  const debt = { ...collateral, id: 'debt', address: '0x0000000000000000000000000000000000000002' as const, symbol: 'USDC', decimals: 6, reserveId: '7' };
  const freshness = { status: 'fresh' as const, blockNumber: '10', observedAt: '2026-11-25T00:00:00Z' };
  const detail: MarketDiscovery = {
    market: { id: `market-v${version}`, chainId: 31337, version, venue: factory, name: 'Market', network: 'Local fork', assets: [collateral, debt], status: 'available' },
    reserves: [collateral, debt].map(asset => ({ asset, canSupply: true, canCollateral: true, canBorrow: true, paused: false, frozen: false, supplyCap: null, borrowCap: null, liquidity: '1000000', borrowRateRay: '40000000000000000000000000' })),
    freshness,
  };
  const discovery: Discovery = { details: new Map([[detail.market.id, detail]]), markets: [detail.market], assets: [collateral, debt], freshness };
  const request = { chainId: 31337, collaterals: [{ assetId: collateral.id, amount: '1', enabled: true }], debt: { assetId: debt.id, amount: '100' } };
  let simulations = 0;
  const client = {
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === 'predictPosition') return owner;
      if (functionName === 'balanceOf') return balance;
      if (functionName === 'allowance') return 0n;
      throw new Error(`Unexpected read: ${functionName}`);
    },
    getBytecode: async () => undefined,
    request: async () => { simulations++; throw new Error('Native execution reverted: 0xfecb69b4'); },
  } as unknown as PublicClient;
  return { client, detail, discovery, request, simulations: () => simulations };
}

for (const version of [3, 4] as const) {
  test(`V${version}: an unfunded wallet can compare rates but cannot prepare execution`, async () => {
    const f = fixture(version);
    const [quote] = await quoteDiscovery(f.client, factory, owner, f.request, f.discovery, salt);
    assert.equal(quote.eligible, true, 'wallet funding must not disable market selection');
    assert.deepEqual(quote.reasons, []);
    assert.equal(quote.executable, false);
    assert.equal(quote.freshness.status, 'fresh', 'market observations remain fresh');
    assert(quote.borrowApy && Number(quote.borrowApy) > 0);
    assert.equal(quote.risk.healthFactor, null, 'failed execution must not fabricate risk');
    assert.match(quote.executionReasons[0], /Insufficient WETH balance.*need 1.*have 0/);
    assert.equal(f.simulations(), 0, 'skip execution when collateral cannot be funded');
    await assert.rejects(buildReviewPlan(f.client, factory, owner, salt, f.request, f.detail, quote), /Insufficient WETH balance/);
  });
}

test('walletless quotes remain available and incompatible collateral remains blocked', async () => {
  const f = fixture(4);
  const [quote] = await quoteDiscovery(f.client, factory, undefined, f.request, f.discovery);
  assert.equal(quote.eligible, true);
  assert.equal(quote.executable, false);
  assert(quote.borrowApy);
  const [incompatible] = await quoteDiscovery(f.client, factory, undefined, { ...f.request, collaterals: [{ assetId: 'unknown', amount: '1', enabled: true }] }, f.discovery);
  assert.equal(incompatible.eligible, false);
  assert.match(incompatible.reasons[0], /not listed/);
});


test('an unavailable execution RPC does not invalidate observed market rates', async () => {
  const f = fixture(3, 10n ** 18n);
  const [quote] = await quoteDiscovery(f.client, factory, owner, f.request, f.discovery, salt);
  assert.equal(quote.eligible, true);
  assert.equal(quote.executable, false);
  assert.equal(quote.rateSource, 'market');
  assert.equal(quote.freshness.status, 'fresh');
  assert.deepEqual(quote.reasons, []);
  assert(quote.borrowApy && quote.executionReasons.length > 0);
  const plan = await buildReviewPlan(f.client, factory, owner, salt, f.request, f.detail, quote);
  assert.equal(plan.riskAfter, null);
  assert.equal(plan.freshness.status, 'fresh');
});

test('a consumed creation intent reports PositionAlreadyExists through the exact quote path', async () => {
  const f = fixture(3, 10n ** 18n);
  const data = encodeErrorResult({ abi: parseAbi(['error PositionAlreadyExists(address account)']), errorName: 'PositionAlreadyExists', args: [owner] });
  f.client.request = (async () => [{ number: '0xa', calls: [
    { status: '0x1', returnData: '0x', gasUsed: '0x1', logs: [] },
    { status: '0x1', returnData: '0x', gasUsed: '0x1', logs: [] },
    { status: '0x0', returnData: data, gasUsed: '0x1', logs: [], error: { code: -3200, message: 'execution failed' } },
    { status: '0x1', returnData: '0x', gasUsed: '0x1', logs: [] },
    { status: '0x1', returnData: '0x', gasUsed: '0x1', logs: [] },
    // viem appends an ETH balance read and removes it from the call results.
    { status: '0x1', returnData: '0x', gasUsed: '0x1', logs: [] },
  ] }]) as typeof f.client.request;
  const [quote] = await quoteDiscovery(f.client, factory, owner, f.request, f.discovery, salt);
  assert.equal(quote.executable, false);
  assert.equal(quote.executionError, 'position_exists');
  assert.match(quote.executionReasons[0], /position already exists/i);
  assert.doesNotMatch(quote.executionReasons[0], /Check the amounts/);
  await assert.rejects(buildReviewPlan(f.client, factory, owner, salt, f.request, f.detail, quote), { code: 'position_exists' });
});

for (const version of [3, 4] as const) {
  test(`V${version}: creation prepares calldata and limits without simulation`, async () => {
    const f = fixture(version, 10n ** 18n);
    f.detail.reserves[0].collateralRiskBps = '2500';
    const [quote] = await quoteDiscovery(f.client, factory, undefined, f.request, f.discovery);
    const plan = await buildReviewPlan(f.client, factory, owner, salt, f.request, f.detail, quote);
    assert.equal(f.simulations(), 0);
    assert.equal(plan.riskAfter, null, 'preparation must not claim simulated risk');
    assert.equal(plan.simulatedAtBlock, undefined);
    assert.equal(plan.approvals[0].spender, plan.account);
    assert.equal(plan.approvals[0].amount, (10n ** 18n).toString());
    const decoded = decodeFunctionData({ abi: factoryAbi, data: plan.transaction.data });
    assert.equal(decoded.functionName, 'createPosition');
    const limits = decoded.args[5];
    assert.equal(limits.minHealthFactor, 1_050_000_000_000_000_000n);
    assert.equal(limits.maxBorrowRateRay, version === 4 ? 52_500_000_000_000_000_000_000_000n : 42_000_000_000_000_000_000_000_000n);
    const refreshed = await buildReviewPlan(f.client, factory, owner, salt, f.request, f.detail, quote, { deadline: plan.deadline, minHealthFactor: plan.minHealthFactor, maxBorrowRateRay: plan.maxBorrowRateRay });
    assert.equal(refreshed.termsHash, plan.termsHash);
    f.client.getBytecode = (async () => '0x1234') as typeof f.client.getBytecode;
    await assert.rejects(buildReviewPlan(f.client, factory, owner, salt, f.request, f.detail, quote), { code: 'position_exists' });
    assert.equal(f.simulations(), 0);
  });
}

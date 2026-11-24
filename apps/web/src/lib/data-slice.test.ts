import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibleReserve, type MarketDiscovery } from './discovery.ts';
import { buildCreateBatch, buildManagementBatch, encodeExecute } from './execution.ts';
import { validateBorrowRequest, validateManagementActions } from './validation.ts';

const address = (last: string) => `0x${last.padStart(40, '0')}` as `0x${string}`;
const detail = (version: 3 | 4 = 3): MarketDiscovery => {
  const market = { id: `31337/v${version}/${address('a')}`, chainId: 31337, version, venue: address('a'), name: 'test', network: 'Anvil', assets: [], status: 'available' as const };
  const collateral = { id: `${market.id}/collateral`, tokenId: '31337/0xcollateral', address: address('c'), symbol: 'COL', name: 'Collateral', decimals: 18, ...(version === 4 ? { reserveId: '4' } : {}) };
  const debt = { id: `${market.id}/debt`, tokenId: '31337/0xdebt', address: address('d'), symbol: 'DEBT', name: 'Debt', decimals: 6, ...(version === 4 ? { reserveId: '7' } : {}) };
  return { market: { ...market, assets: [collateral, debt] }, reserves: [
    { asset: collateral, canSupply: true, canBorrow: false, canCollateral: true, paused: false, frozen: false, supplyCap: null, borrowCap: null, liquidity: null, borrowRateRay: '100000000000000000000000000' },
    { asset: debt, canSupply: true, canBorrow: true, canCollateral: false, paused: false, frozen: false, supplyCap: null, borrowCap: null, liquidity: '1000000', borrowRateRay: version === 3 ? '100000000000000000000000000' : null },
  ], freshness: { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: '1' } };
};

test('request validation rejects cross-chain and duplicate reserves', () => {
  assert.throws(() => validateBorrowRequest({ chainId: 1, collaterals: [], debt: { assetId: 'x', amount: '1' } }), /local chain/);
  assert.throws(() => validateBorrowRequest({ chainId: 31337, collaterals: [{ assetId: 'asset-x', amount: '1', enabled: true }, { assetId: 'asset-x', amount: '1', enabled: true }], debt: { assetId: 'asset-y', amount: '1' } }), /once/);
});

test('native creation batch preserves collections and requires a native rate', () => {
  const current = detail();
  const request = { chainId: 31337, collaterals: [{ assetId: current.reserves[0].asset.id, amount: '1.25', enabled: true }], debt: { assetId: current.reserves[1].asset.id, amount: '10' } };
  const batch = buildCreateBatch(current, request);
  assert.equal(batch.actions.filter((action) => action.kind === 0).length, 1);
  assert.equal(batch.actions.filter((action) => action.kind === 4).length, 1);
  assert.equal(batch.actions.at(-1)?.kind, 2);
  assert.throws(() => buildCreateBatch({ ...current, reserves: current.reserves.map((reserve) => ({ ...reserve, borrowRateRay: null })) }, request), /rate/);
});

test('ambiguous same-token V4 reserves are not selected by token identity', () => {
  const current = detail(4);
  const ambiguous = { ...current, reserves: [...current.reserves, { ...current.reserves[0], asset: { ...current.reserves[0].asset, id: `${current.market.id}/5` } }] };
  assert.equal(compatibleReserve(ambiguous, '31337/0xcollateral', 'collateral'), undefined);
});

test('repay-all funding is bounded while action remains native MAX', () => {
  const current = detail();
  const batch = buildManagementBatch(current, [{ kind: 'repay-all', assetId: current.reserves[1].asset.id, amount: '10.000001' }]);
  assert.equal(batch.actions[0].amount, (1n << 256n) - 1n);
  assert.equal(batch.funding[0].amount, 10_000_001n);
  assert.match(encodeExecute(batch), /^0x[0-9a-f]+$/);
});

test('close withdrawal MAX sentinel is not parsed as a decimal token amount', () => {
  const current = detail();
  const batch = buildManagementBatch(current, [{ kind: 'withdraw', assetId: current.reserves[0].asset.id, amount: ((1n << 256n) - 1n).toString() }]);
  assert.equal(batch.actions[0].amount, (1n << 256n) - 1n);
  assert.equal(batch.funding.length, 0);
  assert.equal(batch.limits.minHealthFactor, 1_060_000_000_000_000_000n);
});

test('closing batches repay first and withdraw every collateral in the same transaction', () => {
  const current = detail();
  const batch = buildManagementBatch(current, [
    { kind: 'repay-all', assetId: current.reserves[1].asset.id, amount: '10.000001' },
    { kind: 'withdraw', assetId: current.reserves[0].asset.id, amount: ((1n << 256n) - 1n).toString() },
  ]);
  assert.deepEqual(batch.actions.map(action => action.kind), [3, 1]);
  assert.equal(batch.funding.length, 1);
  assert.equal(batch.funding[0].amount, 10_000_001n);
  assert(batch.actions.every(action => action.amount === (1n << 256n) - 1n));
  assert.equal(batch.limits.minHealthFactor, 1_060_000_000_000_000_000n);
});

test('management validation permits close marker and rejects empty actions', () => {
  assert.deepEqual(validateManagementActions([{ kind: 'close', assetId: 'reserve' }]), [{ kind: 'close', assetId: 'reserve' }]);
  assert.throws(() => validateManagementActions([]), /actions/);
});

test('configured Core debt reserve resolves duplicate USDC without changing explicit reserve selections', () => {
  const current = detail(4);
  const core = { ...current.reserves[1], borrowRateRay: '40000000000000000000000000' };
  const prime = { ...core, asset: { ...core.asset, id: `${current.market.id}/prime-usdc`, reserveId: '9' } };
  const configured = { ...current, market: { ...current.market, preferredDebtReserveIds: ['7'] }, reserves: [current.reserves[0], prime, core] };
  assert.equal(compatibleReserve(configured, core.asset.tokenId!, 'debt')?.asset.reserveId, '7');
  assert.equal(compatibleReserve(configured, prime.asset.id, 'debt')?.asset.reserveId, '9');
  assert.equal(compatibleReserve({ ...configured, market: { ...configured.market, preferredDebtReserveIds: ['7', '9'] } }, core.asset.tokenId!, 'debt'), undefined);
  const batch = buildCreateBatch(configured, { chainId: 31337, collaterals: [{ assetId: current.reserves[0].asset.tokenId!, amount: '1', enabled: true }], debt: { assetId: core.asset.tokenId!, amount: '100' } });
  assert.equal(batch.actions.find(action => action.kind === 2)?.reserveId, 7n);
});

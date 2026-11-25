import assert from 'node:assert/strict';
import test from 'node:test';
import type { Asset, Position } from './domain.ts';
import type { CatalogMarket } from './market-catalog.ts';
import { managementSupplyAssets } from './management-assets.ts';
import { buildPositionManagementPlan } from './management-plan.ts';
import { decodeFunctionData } from 'viem';
import { accountAbi } from './abis.ts';

const address = '0x00000000000000000000000000000000000000a1';
const asset = (reserveId: string, token = address): Asset => ({ id: `market/${reserveId}/${token}`, address: token as `0x${string}`, symbol: 'USDC', name: 'USD Coin', decimals: 6, reserveId });
const first = asset('4');
const second = asset('7', address.toUpperCase().replace('0X', '0x'));
const other = asset('9', '0x00000000000000000000000000000000000000b1');
const position: Position = {
  id: 'position', chainId: 31337, account: address, owner: address, salt: `0x${'0'.repeat(64)}`,
  market: { id: 'market', chainId: 31337, version: 4, venue: address, name: 'Bluechip', network: 'Anvil', assets: [first, second, other], status: 'available' },
  collaterals: [], debts: [], risk: { healthFactor: null, ltv: null, debtUsd: '0', collateralUsd: '0', borrowCapacityUsd: null },
  freshness: { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: '1' }, activity: [], status: 'open',
};
const catalog: CatalogMarket = { ...position.market, chainId: 1, isTestnet: false, reserves: [first, second, other].map(a => ({ ...a, canSupply: true, canCollateral: true, canBorrow: true })) };

test('supply picker shows each eligible token address once, preserving different tokens with the same symbol', () => {
  assert.deepEqual(managementSupplyAssets(position, [catalog]).map(a => a.id), [first.id, other.id]);
});

test('disabled and non-collateral reserves are filtered before deduplication', () => {
  const disabled = { ...catalog, reserves: catalog.reserves.map(r => ({ ...r, canSupply: r.reserveId !== '4', canCollateral: r.reserveId !== '9' })) };
  assert.deepEqual(managementSupplyAssets(position, [disabled]).map(a => a.id), [second.id]);
});

test('existing supplied reserve is preferred and its exact reserve ID reaches calldata', () => {
  const existing = { ...position, collaterals: [{ asset: second, amount: '1', collateralEnabled: true }] };
  const [selected] = managementSupplyAssets(existing, [catalog]);
  assert.equal(selected.id, second.id);
  const plan = buildPositionManagementPlan(existing, { kind: 'supply', assetId: selected.id, amount: '2', enabled: true });
  const decoded = decodeFunctionData({ abi: accountAbi, data: plan.transaction.data });
  assert.equal(decoded.functionName, 'execute');
  assert.equal(decoded.args[1][0][2], 7n);
});

test('eligibility matches exact venue, chain, version and reserve, and missing catalog is not guessed', () => {
  assert.deepEqual(managementSupplyAssets(position, []), []);
  assert.deepEqual(managementSupplyAssets(position, [{ ...catalog, chainId: 8453 }]), []);
  assert.deepEqual(managementSupplyAssets(position, [{ ...catalog, version: 3 }]), []);
  assert.deepEqual(managementSupplyAssets(position, [{ ...catalog, venue: other.address }]), []);
  assert.deepEqual(managementSupplyAssets(position, [{ ...catalog, reserves: [{ ...catalog.reserves[0], reserveId: '99' }] }]), []);
  assert.deepEqual(managementSupplyAssets(null, [catalog]), []);
});

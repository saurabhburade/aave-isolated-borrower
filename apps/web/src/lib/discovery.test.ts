import test from 'node:test';
import assert from 'node:assert/strict';
import { keccak256, type Address, type PublicClient } from 'viem';
import { createMarketDiscoveryLoader } from './discovery.ts';
import { marketId, type DeploymentManifest } from './deployment.ts';
import type { CatalogMarket, MarketCatalog } from './market-catalog.ts';

const factory = '0x0000000000000000000000000000000000000010';
const pool = '0x0000000000000000000000000000000000000020';
const secondPool = '0x0000000000000000000000000000000000000021';
const token = '0x0000000000000000000000000000000000000030';
const code = '0x6001';
const manifest: DeploymentManifest = { chainId: 31337, rpcUrl: 'http://127.0.0.1:8557', forkBlock: '1', factory, factoryCodeHash: keccak256(code), markets: [] };
const market = (venue: Address = pool, version: 3 | 4 = 3): CatalogMarket => ({ id: `catalog/1/${version}/${venue}`, chainId: 1, version, venue, name: `Aave V${version} dynamic`, network: 'Ethereum', isTestnet: false, reserves: [{ address: token, symbol: 'USDC', name: 'USD Coin', decimals: 6, canSupply: true, canCollateral: true, canBorrow: true, reserveId: '0' }] });

function fixture(markets: CatalogMarket[] = [market()], deployment = structuredClone(manifest)) {
  const reads: { address: string; functionName: string; blockNumber?: bigint }[] = [];
  const missing = new Set<string>();
  let chainId = 31337;
  let blockHash = '0x01';
  let poolBinding = true;
  let factoryCode = code;
  const client = {
    getChainId: async () => chainId,
    getBlock: async () => ({ number: 10n, hash: blockHash }),
    getBytecode: async ({ address }: { address: string }) => address === factory ? factoryCode : missing.has(address) ? '0x' : code,
    readContract: async (request: { address: string; functionName: string; blockNumber?: bigint }) => {
      reads.push(request);
      switch (request.functionName) {
        case 'ADDRESSES_PROVIDER': return request.address;
        case 'getPool': return poolBinding ? request.address : factory;
        case 'getPriceOracle': return factory;
        case 'BASE_CURRENCY': return '0x0000000000000000000000000000000000000000';
        case 'BASE_CURRENCY_UNIT': return 100000000n;
        case 'getReservesList': return [token];
        case 'symbol': return 'USDC';
        case 'name': return 'USD Coin';
        case 'decimals': return 6;
        case 'getReserveData': return [0n, 0n, 0n, 0n, 4n * 10n ** 25n, 0n, 0n, 0n, token, token, token];
        case 'getConfiguration': return (1n << 56n) | (1n << 58n) | 7500n;
        case 'totalSupply': case 'balanceOf': return 1000000n;
        case 'getReserveCount': return 1n;
        case 'getReserve': return [token, factory, 0n, 6, 0n, 0n, 0n];
        case 'getReserveConfig': return [0n, false, false, true];
        case 'getDynamicReserveConfig': return [7500n];
        case 'getAssetDrawnRate': return 4n * 10n ** 25n;
        case 'getSpokeConfig': return [(1n << 40n) - 1n, (1n << 40n) - 1n, 0n, true, false];
        case 'getSpokeAddedAssets': case 'getSpokeTotalOwed': case 'getSpokeDeficitRay': return 0n;
        case 'getAssetLiquidity': return 1000000n;
        default: throw new Error(`Unexpected read: ${request.functionName}`);
      }
    },
  } as unknown as PublicClient;
  let catalog: MarketCatalog = { markets, errors: [] };
  const load = createMarketDiscoveryLoader({ loadManifest: async () => ({ manifest: deployment }), loadCatalog: async chain => { assert.equal(chain, 1); return catalog; } });
  return { load, client, reads, missing, deployment, setChain: (next: number) => { chainId = next; }, setHash: (next: string) => { blockHash = next; }, setPoolBinding: (next: boolean) => { poolBinding = next; }, setFactoryCode: (next: string) => { factoryCode = next; }, setCatalog: (next: MarketCatalog) => { catalog = next; } };
}

for (const version of [3, 4] as const) test(`discovers a catalog V${version} market without adding it to the deployment manifest`, async () => {
  const f = fixture([market(pool, version)]);
  const result = await f.load(f.client, { marketIds: [marketId(31337, version, pool)] });
  assert.equal(result.markets[0].status, 'available');
  assert.equal(result.markets[0].version, version);
  assert.equal(result.details.get(result.markets[0].id)?.reserves.length, 1);
  assert.equal(result.assets[0].id, `31337/${token}`);
  assert(f.reads.every(read => read.blockNumber === 10n), 'inventory uses one observed fork block');
  assert.deepEqual(f.deployment.markets, [], 'dynamic discovery never rewrites deployment configuration');
});

test('selected-market discovery does not inventory other venues; summary avoids reserve reads', async () => {
  const f = fixture([market(), market(secondPool)]);
  const summary = await f.load(f.client, { summary: true });
  assert.equal(summary.markets.length, 2);
  assert(summary.markets.every(market => market.status === 'unchecked'));
  assert.equal(f.reads.length, 0, 'browsing never probes every venue before selection');
  assert(!f.reads.some(read => read.functionName === 'getReservesList'));
  f.reads.length = 0;
  await f.load(f.client, { marketIds: [marketId(31337, 3, secondPool)] });
  assert(f.reads.some(read => read.address === secondPool && read.functionName === 'getReservesList'));
  assert(!f.reads.some(read => read.address === pool));
});

test('excludes other chains, testnets and arbitrary venues before any RPC inventory', async () => {
  const f = fixture([{ ...market(), chainId: 8453 }, { ...market(secondPool), isTestnet: true }]);
  for (const id of [marketId(31337, 3, pool), marketId(8453, 3, pool), marketId(31337, 3, factory)]) {
    await assert.rejects(f.load(f.client, { marketIds: [id] }), /not in the official Ethereum Aave catalog/);
  }
  assert.equal(f.reads.length, 0);
});

test('a missing deployment or incompatible Pool is unavailable while healthy markets remain usable', async () => {
  const f = fixture([market(), market(secondPool)]);
  f.missing.add(pool);
  const result = await f.load(f.client);
  assert.match(result.markets[0].reason!, /not deployed at the current fork block/);
  assert.equal(result.markets[1].status, 'available');
  assert.equal(result.freshness.status, 'fresh');
  const incompatible = fixture(); incompatible.setPoolBinding(false);
  assert.match((await incompatible.load(incompatible.client)).markets[0].reason!, /does not recognize this Pool/);
});

test('local code pins take precedence over catalog discovery and remain enforced', async () => {
  const deployment: DeploymentManifest = { ...structuredClone(manifest), markets: [{ version: 3 as const, venue: pool, name: 'Pinned Pool', verifiedBlock: '1', revision: 'Pinned', venueCodeHash: keccak256('0x6002') }] };
  const f = fixture([market()], deployment);
  const result = await f.load(f.client);
  assert.equal(result.markets.length, 1);
  assert.equal(result.markets[0].name, 'Pinned Pool');
  assert.match(result.markets[0].reason!, /does not match the manifest/);
});

test('shares concurrent inventory reads and invalidates inventory on block hash changes', async () => {
  const f = fixture();
  await Promise.all([f.load(f.client), f.load(f.client)]);
  assert.equal(f.reads.filter(read => read.functionName === 'getReservesList').length, 1);
  f.setHash('0x02');
  await f.load(f.client);
  assert.equal(f.reads.filter(read => read.functionName === 'getReservesList').length, 2);
  f.setFactoryCode('0x6002');
  const invalid = await f.load(f.client);
  assert.equal(invalid.freshness.status, 'unavailable', 'cached inventory cannot bypass factory verification');
  assert.match(invalid.freshness.reason!, /Factory bytecode hash/);
});

test('failed discovery retries and wrong-chain RPC cannot authorize execution', async () => {
  const f = fixture();f.missing.add(pool);
  assert.equal((await f.load(f.client)).markets[0].status, 'unavailable');
  f.missing.clear();
  assert.equal((await f.load(f.client)).markets[0].status, 'available');
  f.setChain(1);
  assert.match((await f.load(f.client)).freshness.reason!, /expected 31337/);
});

test('catalog failure preserves explicitly configured deployments', async () => {
  const deployment: DeploymentManifest = { ...structuredClone(manifest), markets: [{ version: 3 as const, venue: pool, name: 'Pinned Pool', verifiedBlock: '1', revision: 'Pinned', venueCodeHash: keccak256(code), preferredDebtReserveIds: ['7'] }] };
  const f = fixture([], deployment);f.setCatalog({ markets: [], errors: ['Provider unavailable'] });
  const result = await f.load(f.client);
  assert.equal(result.markets[0].status, 'available');
});

test('quoting inventories only requested tokens and cannot reuse that partial inventory as a full one', async () => {
  const f = fixture();
  const otherToken = '0x0000000000000000000000000000000000000031';
  const read = f.client.readContract;
  const reserveReads: string[] = [];
  f.client.readContract = (async (args: any) => {
    if (args.functionName === 'getReservesList') return [token, otherToken];
    if (args.functionName === 'getReserveData') reserveReads.push(args.args[0]);
    return read(args);
  }) as typeof read;
  const partial = await f.load(f.client, { marketIds: [marketId(31337, 3, pool)], assetIds: [`31337/${token}`] });
  assert.equal(partial.markets[0].assets.length, 1);
  assert.deepEqual(reserveReads, [token], 'unrelated reserve cannot block a new-position quote');
  const full = await f.load(f.client);
  assert.equal(full.markets[0].assets.length, 2, 'portfolio and tooling still read complete inventories');
});

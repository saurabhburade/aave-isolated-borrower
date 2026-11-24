import { mapRpc } from './rpc-batch.ts';
import { BaseError, formatUnits, hexToString, type PublicClient, type Address as ViemAddress } from 'viem';
import type { Asset, Freshness, Market } from './domain.ts';
import { erc20Abi, erc20Bytes32MetadataAbi, v3PoolAbi, v3ProviderAbi, v3OracleAbi, v4HubAbi, v4SpokeAbi } from './abis.ts';
import { createLocalClient, loadDeploymentManifest, manifestAsset, marketId, unavailableFreshness, unavailableMarket, verifyDeploymentCode, type MarketDefinition } from './deployment.ts';
import { LOCAL_CHAIN_ID } from './validation.ts';
import { getMarketCatalog } from './server-market-catalog.ts';
import type { MarketCatalog } from './market-catalog.ts';

export interface ReserveDetails { collateralRiskBps?: string; supplyCapRemaining?: string | null; borrowCapRemaining?: string | null; supplyUncapped?: boolean; borrowUncapped?: boolean; asset: Asset; canSupply: boolean; canBorrow: boolean; canCollateral: boolean; paused: boolean; frozen: boolean; supplyCap: string | null; borrowCap: string | null; liquidity: string | null; borrowRateRay: string | null; }
export interface MarketDiscovery { usdDecimals?: number; market: Market; reserves: ReserveDetails[]; freshness: Freshness; }
export interface Discovery { markets: Market[]; assets: Asset[]; details: Map<string, MarketDiscovery>; freshness: Freshness; }

const bits = (data: bigint, start: number, width: number) => (data >> BigInt(start)) & ((1n << BigInt(width)) - 1n);
const nonZero = (value: string | undefined) => value && !/^0x0*$/i.test(value);
const selectedAsset = (address: string, assetIds?: readonly string[]) => !assetIds || assetIds.some(id => id.split('/').at(-1)?.toLowerCase() === address.toLowerCase());

async function tokenMetadata(client: PublicClient, address: ViemAddress, blockNumber: bigint): Promise<{ symbol: string; name: string; decimals: number }> {
  const readText = async (functionName: 'symbol' | 'name'): Promise<string> => {
    try { return await client.readContract({ address, abi: erc20Abi, functionName, blockNumber }); }
    catch { const raw = await client.readContract({ address, abi: erc20Bytes32MetadataAbi, functionName, blockNumber }); return hexToString(raw).replace(/\0+$/g, ''); }
  };
  const [symbol, name, decimals] = await Promise.all([readText('symbol'), readText('name'), client.readContract({ address, abi: erc20Abi, functionName: 'decimals', blockNumber })]);
  return { symbol, name, decimals: Number(decimals) };
}

async function discoverV3(client: PublicClient, raw: MarketDefinition, blockNumber: bigint, assetIds?: readonly string[]): Promise<MarketDiscovery> {
  const venue = raw.venue as ViemAddress;
  const reserveAddresses = await client.readContract({ address: venue, abi: v3PoolAbi, functionName: 'getReservesList', blockNumber });
  const provider = await client.readContract({ address: venue, abi: v3PoolAbi, functionName: 'ADDRESSES_PROVIDER', blockNumber });
  const oracle = await client.readContract({ address: provider, abi: v3ProviderAbi, functionName: 'getPriceOracle', blockNumber });
  const [currency, unit] = await Promise.all([
    client.readContract({ address: oracle, abi: v3OracleAbi, functionName: 'BASE_CURRENCY', blockNumber }),
    client.readContract({ address: oracle, abi: v3OracleAbi, functionName: 'BASE_CURRENCY_UNIT', blockNumber }),
  ]);
  const usdDecimals = /^0x0{40}$/i.test(currency) && /^10*$/.test(unit.toString()) ? unit.toString().length - 1 : undefined;
  const reserves = await mapRpc(reserveAddresses.filter(address => selectedAsset(address, assetIds)), async (address) => {
    const [meta, reserve, config] = await Promise.all([
      tokenMetadata(client, address, blockNumber),
      client.readContract({ address: venue, abi: v3PoolAbi, functionName: 'getReserveData', args: [address], blockNumber }),
      client.readContract({ address: venue, abi: v3PoolAbi, functionName: 'getConfiguration', args: [address], blockNumber }),
    ]);
    const data = BigInt(config);
    const asset: Asset = { id: `${marketId(LOCAL_CHAIN_ID, 3, venue)}/${address.toLowerCase()}`, tokenId: `${LOCAL_CHAIN_ID}/${address.toLowerCase()}`, address, symbol: meta.symbol, name: meta.name, decimals: meta.decimals };
    const supplyCap = bits(data, 116, 36);
    const borrowCap = bits(data, 80, 36);
    const [supplied, borrowed, liquidity] = await Promise.all([
      client.readContract({ address: reserve[8], abi: erc20Abi, functionName: 'totalSupply', blockNumber }),
      (/^0x0{40}$/i.test(reserve[10]) ? Promise.resolve(0n) : client.readContract({ address: reserve[10], abi: erc20Abi, functionName: 'totalSupply', blockNumber })),
      client.readContract({ address, abi: erc20Abi, functionName: 'balanceOf', args: [reserve[8]], blockNumber }),
    ]);
    const remaining = (cap: bigint, used: bigint) => cap === 0n ? null : formatUnits(cap * 10n ** BigInt(meta.decimals) > used ? cap * 10n ** BigInt(meta.decimals) - used : 0n, meta.decimals);
    return { asset, supplyCapRemaining: remaining(supplyCap, supplied), borrowCapRemaining: remaining(borrowCap, borrowed), supplyUncapped: supplyCap === 0n, borrowUncapped: borrowCap === 0n, canSupply: bits(data, 56, 1) === 1n && bits(data, 57, 1) === 0n && bits(data, 60, 1) === 0n, canBorrow: bits(data, 56, 1) === 1n && bits(data, 57, 1) === 0n && bits(data, 58, 1) === 1n && bits(data, 60, 1) === 0n, canCollateral: bits(data, 0, 16) > 0n && bits(data, 56, 1) === 1n && bits(data, 60, 1) === 0n, paused: bits(data, 60, 1) === 1n, frozen: bits(data, 57, 1) === 1n, supplyCap: supplyCap === 0n ? null : supplyCap.toString(), borrowCap: borrowCap === 0n ? null : borrowCap.toString(), liquidity: formatUnits(liquidity, meta.decimals), borrowRateRay: BigInt(reserve[4]).toString() };
  });
  const market: Market = { id: marketId(LOCAL_CHAIN_ID, 3, venue), chainId: LOCAL_CHAIN_ID, version: 3, venue, name: raw.name, network: raw.network ?? 'Anvil fork', assets: reserves.map((r) => r.asset), status: 'available', verifiedBlock: raw.verifiedBlock, revision: raw.revision };
  return { market, reserves, usdDecimals, freshness: { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: blockNumber.toString() } };
}

async function discoverV4(client: PublicClient, raw: MarketDefinition, blockNumber: bigint, assetIds?: readonly string[]): Promise<MarketDiscovery> {
  const venue = raw.venue as ViemAddress;
  const count = await client.readContract({ address: venue, abi: v4SpokeAbi, functionName: 'getReserveCount', blockNumber });
  if (count > 256n) throw new Error('This Spoke exceeds the supported complete reserve inventory.');
  const mappings = await mapRpc(Array.from({ length: Number(count) }, (_, index) => BigInt(index)), async index => ({ index, reserve: await client.readContract({ address: venue, abi: v4SpokeAbi, functionName: 'getReserve', args: [index], blockNumber }) }));
  const reserves = await mapRpc(mappings.filter(({ reserve }) => selectedAsset(reserve[0], assetIds)), async ({ index, reserve }) => {
    const config = await client.readContract({ address: venue, abi: v4SpokeAbi, functionName: 'getReserveConfig', args: [index], blockNumber });
    const address = reserve[0] as ViemAddress;
    const hub = reserve[1] as ViemAddress;
    const assetId = BigInt(reserve[2]);
    const meta = await tokenMetadata(client, address, blockNumber);
    const asset: Asset = { id: `${marketId(LOCAL_CHAIN_ID, 4, venue)}/${index.toString()}/${address.toLowerCase()}`, tokenId: `${LOCAL_CHAIN_ID}/${address.toLowerCase()}`, address, symbol: meta.symbol, name: meta.name, decimals: Number(reserve[3]), reserveId: index.toString() };
    const dynamic = await client.readContract({ address: venue, abi: v4SpokeAbi, functionName: 'getDynamicReserveConfig', args: [index, reserve[6]], blockNumber }).catch(() => null);
    const borrowRateRay = await client.readContract({ address: hub, abi: v4HubAbi, functionName: 'getAssetDrawnRate', args: [assetId], blockNumber }).then((rate) => BigInt(rate).toString()).catch(() => null);
    const [hubConfig, added, owed, deficitRay, liquidity] = await Promise.all([
      client.readContract({ address: hub, abi: v4HubAbi, functionName: 'getSpokeConfig', args: [assetId, venue], blockNumber }),
      client.readContract({ address: hub, abi: v4HubAbi, functionName: 'getSpokeAddedAssets', args: [assetId, venue], blockNumber }),
      client.readContract({ address: hub, abi: v4HubAbi, functionName: 'getSpokeTotalOwed', args: [assetId, venue], blockNumber }),
      client.readContract({ address: hub, abi: v4HubAbi, functionName: 'getSpokeDeficitRay', args: [assetId, venue], blockNumber }),
      client.readContract({ address: hub, abi: v4HubAbi, functionName: 'getAssetLiquidity', args: [assetId], blockNumber }),
    ]);
    const unlimitedCap = (1n << 40n) - 1n;
    const remaining = (cap: bigint, used: bigint) => cap === unlimitedCap ? null : formatUnits(cap * 10n ** BigInt(asset.decimals) > used ? cap * 10n ** BigInt(asset.decimals) - used : 0n, asset.decimals);
    const deficit = (deficitRay + 10n ** 27n - 1n) / 10n ** 27n;
    return { asset, collateralRiskBps: config[0].toString(), supplyCapRemaining: remaining(BigInt(hubConfig[0]), added + 1n), borrowCapRemaining: remaining(BigInt(hubConfig[1]), owed + deficit), supplyUncapped: BigInt(hubConfig[0]) === unlimitedCap, borrowUncapped: BigInt(hubConfig[1]) === unlimitedCap, canSupply: hubConfig[3] && !hubConfig[4] && !config[1] && !config[2], canBorrow: hubConfig[3] && !hubConfig[4] && !config[1] && !config[2] && config[3], canCollateral: Boolean(dynamic && dynamic[0] > 0n), paused: config[1], frozen: config[2], supplyCap: null, borrowCap: null, liquidity: formatUnits(liquidity, asset.decimals), borrowRateRay };
  });
  const market: Market = { preferredDebtReserveIds: raw.preferredDebtReserveIds, id: marketId(LOCAL_CHAIN_ID, 4, venue), chainId: LOCAL_CHAIN_ID, version: 4, venue, name: raw.name, network: raw.network ?? 'Anvil fork', assets: reserves.map((r) => r.asset), status: 'available', verifiedBlock: raw.verifiedBlock, revision: raw.revision };
  return { market, reserves, freshness: { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: blockNumber.toString() } };
}

export interface DiscoveryOptions { marketIds?: readonly string[]; assetIds?: readonly string[]; summary?: boolean }

/** Official Ethereum catalog supplies venues; deployment entries keep local pins and reserve preferences. */
function marketDefinitions(manifest: Awaited<ReturnType<typeof loadDeploymentManifest>>['manifest'], catalog: MarketCatalog): MarketDefinition[] {
  const definitions = new Map<string, MarketDefinition>();
  for (const item of catalog.markets) {
    if (item.chainId !== 1 || item.isTestnet || !/^0x[0-9a-f]{40}$/i.test(item.venue) || (item.version !== 3 && item.version !== 4)) continue;
    const id = marketId(LOCAL_CHAIN_ID, item.version, item.venue);
    definitions.set(id, { version: item.version, venue: item.venue, name: item.name, network: 'Ethereum fork', assets: item.reserves.filter(asset => /^0x[0-9a-f]{40}$/i.test(asset.address)).map(asset => ({ ...asset, address: asset.address as ViemAddress })) });
  }
  for (const item of manifest?.markets ?? []) {
    const id = marketId(LOCAL_CHAIN_ID, item.version, item.venue);
    const catalogAssets = definitions.get(id)?.assets;
    definitions.set(id, { ...item, assets: catalogAssets ?? item.assets });
  }
  return [...definitions.values()];
}

export function createMarketDiscoveryLoader({ loadManifest = loadDeploymentManifest, loadCatalog = getMarketCatalog }: {
  loadManifest?: typeof loadDeploymentManifest; loadCatalog?: (chainId: number) => Promise<MarketCatalog>;
} = {}) {
  const cache = new Map<string, { expires: number; value: Promise<MarketDiscovery> }>();
  return async (client = createLocalClient(), options: DiscoveryOptions = {}): Promise<Discovery> => {
    const state = await loadManifest();
    if (!state.manifest) return { markets: [], assets: [], details: new Map(), freshness: unavailableFreshness(state.reason ?? 'Deployment manifest unavailable.') };
    const manifest = state.manifest;
    if (manifest.chainId !== LOCAL_CHAIN_ID) return { markets: [], assets: [], details: new Map(), freshness: unavailableFreshness('Deployment manifest is not for chain 31337.') };
    const catalog = await loadCatalog(1).catch(() => ({ markets: [], errors: ['Aave market discovery is temporarily unavailable.'] }));
    const definitions = marketDefinitions(manifest, catalog);
    const requested = options.marketIds ? new Set(options.marketIds) : null;
    const selected = definitions.filter(raw => !requested || requested.has(marketId(LOCAL_CHAIN_ID, raw.version, raw.venue)));
    if (requested && [...requested].some(id => !selected.some(raw => marketId(LOCAL_CHAIN_ID, raw.version, raw.venue) === id))) {
      throw new Error('Selected market is not in the official Ethereum Aave catalog or local deployment. Refresh markets and try again.');
    }
    try {
      const [chainId, block, factoryOk] = await Promise.all([client.getChainId(), client.getBlock(), verifyDeploymentCode(client, manifest.factory, manifest.factoryCodeHash, manifest.factoryImplementationAddress, manifest.factoryImplementationCodeHash)]);
      if (chainId !== LOCAL_CHAIN_ID) throw new Error(`RPC chain is ${chainId}, expected ${LOCAL_CHAIN_ID}.`);
      if (!factoryOk) throw new Error('Factory bytecode hash does not match the verified manifest.');
      for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
      const entries = await mapRpc(selected, async raw => {
        const id = marketId(LOCAL_CHAIN_ID, raw.version, raw.venue);
        if (options.summary) {
          const market: Market = { ...unavailableMarket(raw, ''), status: 'unchecked', reason: undefined };
          const candidate: MarketDiscovery = { market, reserves: [], freshness: { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: block.number.toString() } };
          return [id, candidate] as const;
        }
        const key = JSON.stringify([manifest.factory, manifest.factoryCodeHash, block.hash ?? block.number.toString(), raw, options.assetIds ? [...new Set(options.assetIds)].sort() : null]);
        let cached = cache.get(key);
        if (!cached) {
          const value = (async (): Promise<MarketDiscovery> => {
            if (raw.venueCodeHash) {
              if (!(await verifyDeploymentCode(client, raw.venue, raw.venueCodeHash, raw.implementation, raw.implementationCodeHash))) throw new Error('Venue bytecode or verified implementation does not match the manifest.');
            } else {
              const code = await client.getBytecode({ address: raw.venue, blockNumber: block.number });
              if (!code || !nonZero(code)) throw new Error('This market is not deployed at the current fork block.');
            }
            if (raw.version === 3) {
              const provider = await client.readContract({ address: raw.venue, abi: v3PoolAbi, functionName: 'ADDRESSES_PROVIDER', blockNumber: block.number });
              const pool = await client.readContract({ address: provider, abi: v3ProviderAbi, functionName: 'getPool', blockNumber: block.number });
              if (pool.toLowerCase() !== raw.venue.toLowerCase()) throw new Error('The Aave addresses provider does not recognize this Pool.');
            } else {
              const count = await client.readContract({ address: raw.venue, abi: v4SpokeAbi, functionName: 'getReserveCount', blockNumber: block.number });
              if (count === 0n || count > 256n) throw new Error('This market does not expose a supported Aave V4 reserve inventory.');
            }
            return raw.version === 3 ? discoverV3(client, raw, block.number, options.assetIds) : discoverV4(client, raw, block.number, options.assetIds);
          })();
          cached = { expires: Infinity, value };
          cache.set(key, cached);
          if (cache.size > 128) cache.delete(cache.keys().next().value!);
        }
        try {
          const detail = await cached.value;
          if (cached.expires === Infinity) cached.expires = Date.now() + 10_000;
          return [id, detail] as const;
        }
        catch (error) {
          cache.delete(key);
          const reason = error instanceof BaseError ? `${error.shortMessage} Try refreshing this market.` : error instanceof Error ? error.message : 'Native market discovery failed.';
          const unavailable: MarketDiscovery = { market: unavailableMarket(raw, reason), reserves: [], freshness: unavailableFreshness(reason) };
          return [id, unavailable] as const;
        }
      });
      const details = new Map<string, MarketDiscovery>(entries);
      const markets = [...details.values()].map(detail => detail.market);
      const assets = [...new Map(markets.flatMap(market => market.assets).map(asset => [asset.tokenId ?? asset.id, { ...asset, id: asset.tokenId ?? asset.id, reserveId: undefined }])).values()];
      const available = markets.some(market => market.status === 'available' || (options.summary && market.status === 'unchecked'));
      return { markets, assets, details, freshness: { status: available ? 'fresh' : 'unavailable', observedAt: new Date().toISOString(), blockNumber: block.number.toString(), ...(!available ? { reason: markets[0]?.reason ?? 'No compatible market is available on the current fork.' } : {}) } };
    } catch (error) {
      const reason = error instanceof BaseError ? error.shortMessage : error instanceof Error ? error.message : 'Local chain discovery failed.';
      return { markets: selected.map(raw => unavailableMarket(raw, reason)), assets: [], details: new Map(), freshness: unavailableFreshness(reason) };
    }
  };
}

export const discoverMarkets = createMarketDiscoveryLoader();

export function findAsset(discovery: Discovery, marketIdValue: string, assetId: string): Asset | undefined {
  return discovery.details.get(marketIdValue)?.market.assets.find((asset) => asset.id === assetId || asset.tokenId === assetId || asset.address.toLowerCase() === assetId.toLowerCase());
}

export function compatibleReserve(detail: MarketDiscovery, assetId: string, kind: 'collateral' | 'debt'): ReserveDetails | undefined {
  const exact = detail.reserves.find((candidate) => candidate.asset.id === assetId);
  if (exact) return exact;
  const matches = detail.reserves.filter((candidate) => candidate.asset.tokenId === assetId || candidate.asset.address.toLowerCase() === assetId.toLowerCase());
  if (matches.length === 1) return matches[0];
  if (kind === 'debt' && detail.market.version === 4) {
    const preferred = matches.filter(reserve => detail.market.preferredDebtReserveIds?.includes(reserve.asset.reserveId ?? ''));
    if (preferred.length === 1) return preferred[0];
  }
  return undefined;
}


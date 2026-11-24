import { parseUnits } from 'viem';
import type { Address, ProtocolVersion } from './domain.ts';
import type { CatalogMarket, MarketCatalog } from './market-catalog.ts';

const ENDPOINTS = { 3: 'https://api.v3.aave.com/graphql', 4: 'https://api.v4.aave.com/graphql' } as const;
interface Chain { chainId: number; name: string; isTestnet: boolean }
interface Venue { address: Address; name: string; chain: Chain }
interface V3Reserve {
  underlyingToken: { address: string; symbol: string; name: string; decimals: number; imageUrl: string };
  usdExchangeRate: string; isPaused: boolean; isFrozen: boolean;
  supplyInfo: { canBeCollateral: boolean; supplyCapReached: boolean; maxLTV: { value: string }; liquidationThreshold: { value: string } };
  borrowInfo: { borrowingState: string; borrowCapReached: boolean } | null;
}
interface V3Market extends Venue { reserves: V3Reserve[] }
interface V4Spoke extends Venue { id: string; displayName: string }
interface V4Reserve {
  onChainId: string; spoke: { id: string };
  asset: { underlying: { address: string; info: { symbol: string; name: string; decimals: number; icon: string } } };
  canBorrow: boolean; canSupply: boolean; canUseAsCollateral: boolean;
  oracle: { price: { value: string } | null };
  settings: { collateralFactor: { value: string }; collateralRisk?: { value: string } };
}

const V3_QUERY = `query MarketCatalog($request: MarketsRequest!) {
  markets(request: $request) {
    name address chain { chainId name isTestnet }
    reserves(request: {reserveType: BOTH, orderBy: {tokenName: ASC}}) {
      underlyingToken { address symbol name decimals imageUrl }
      usdExchangeRate isPaused isFrozen
      supplyInfo { canBeCollateral supplyCapReached maxLTV { value } liquidationThreshold { value } }
      borrowInfo { borrowingState borrowCapReached }
    }
  }
}`;
const V4_QUERY = `query MarketCatalog($request: SpokesRequest!, $reserves: ReservesRequest!) {
  spokes(request: $request) { id name displayName address chain { chainId name isTestnet } }
  reserves(request: $reserves) {
    onChainId spoke { id } asset { underlying { address info { symbol name decimals icon } } }
    canBorrow canSupply canUseAsCollateral oracle { price { value } } settings { collateralFactor { value } collateralRisk { value } }
  }
}`;

export async function aaveGraphql<T>(version: ProtocolVersion, query: string, variables: Record<string, unknown>, fetcher: typeof fetch = fetch): Promise<T> {
  const response = await fetcher(ENDPOINTS[version], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(15_000), cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const result = await response.json() as { data?: T; errors?: { message: string }[] };
  if (!result.data || result.errors?.length) throw new Error(result.errors?.[0]?.message ?? 'No market data returned');
  return result.data;
}

function venue(version: ProtocolVersion, item: Venue): Omit<CatalogMarket, 'reserves'> {
  const name = version === 3 ? item.name.replace(/^AaveV3/, '').replace(/([a-z])([A-Z])/g, '$1 $2') : item.name;
  return { id: `catalog/${item.chain.chainId}/${version}/${item.address.toLowerCase()}`, chainId: item.chain.chainId, version, venue: item.address, name: `Aave V${version} ${name}`, network: item.chain.name, isTestnet: item.chain.isTestnet };
}

export function createMarketCatalogLoader(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { expires: number; value: Promise<CatalogMarket[]> }>();
  async function load(version: ProtocolVersion, chainId: number): Promise<CatalogMarket[]> {
    const key = `${version}/${chainId}`;
    const previous = cache.get(key);
    if (previous && previous.expires > Date.now()) return previous.value;
    const value = (async () => {
      if (version === 3) {
        const result = await aaveGraphql<{ markets: V3Market[] }>(3, V3_QUERY, { request: { chainIds: [chainId] } }, fetcher);
        return result.markets.map(item => ({ ...venue(3, item), reserves: item.reserves.map(reserve => ({
          ...reserve.underlyingToken, icon: reserve.underlyingToken.imageUrl, usdPrice: reserve.usdExchangeRate,
          canSupply: !reserve.isPaused && !reserve.isFrozen && !reserve.supplyInfo.supplyCapReached,
          canCollateral: reserve.supplyInfo.canBeCollateral,
          maxLtv: reserve.supplyInfo.maxLTV?.value ?? null, liquidationThreshold: reserve.supplyInfo.liquidationThreshold?.value ?? null,
          canBorrow: !reserve.isPaused && !reserve.isFrozen && reserve.borrowInfo?.borrowingState === 'ENABLED' && !reserve.borrowInfo.borrowCapReached,
        })) }));
      }
      const result = await aaveGraphql<{ spokes: V4Spoke[]; reserves: V4Reserve[] }>(4, V4_QUERY, { request: { query: { chainIds: [chainId] } }, reserves: { query: { chainIds: [chainId] }, filter: 'ALL', orderBy: { assetName: 'ASC' } } }, fetcher);
      return result.spokes.map(item => ({ ...venue(4, { ...item, name: item.displayName || item.name }), reserves: result.reserves.filter(reserve => reserve.spoke.id === item.id).map(reserve => ({
        reserveId: reserve.onChainId, address: reserve.asset.underlying.address, ...reserve.asset.underlying.info,
        canBorrow: reserve.canBorrow, canSupply: reserve.canSupply, canCollateral: reserve.canUseAsCollateral,
        usdPrice: reserve.oracle?.price?.value ?? null,
        collateralRiskBps: reserve.settings?.collateralRisk?.value != null ? parseUnits(reserve.settings.collateralRisk.value, 4).toString() : null,
        maxLtv: reserve.settings?.collateralFactor.value ?? null, liquidationThreshold: reserve.settings?.collateralFactor.value ?? null,
      })) }));
    })();
    const entry = { expires: Infinity, value };
    cache.set(key, entry);
    try { const markets = await value; entry.expires = Date.now() + 60_000; return markets; }
    catch (error) { cache.delete(key); throw error; }
  }
  return async (chainId = 1): Promise<MarketCatalog> => {
    const versions = [3, 4] as const;
    const results = await Promise.allSettled(versions.map(version => load(version, chainId)));
    const markets: CatalogMarket[] = [];
    const errors: string[] = [];
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') markets.push(...result.value);
      else errors.push(`Aave V${versions[index]} markets are unavailable. Try refreshing.`);
    });
    markets.sort((a, b) => a.version - b.version || a.name.localeCompare(b.name) || a.venue.localeCompare(b.venue));
    return { markets, errors };
  };
}

export const getMarketCatalog = createMarketCatalogLoader();

import type { Address, Asset, BorrowRequest, Market, ProtocolVersion, RiskMetrics } from './domain.ts';

export interface CatalogReserve {
  address: string; symbol: string; reserveId?: string;
  name: string; decimals: number; icon?: string; usdPrice?: string | null;
  canSupply: boolean; canBorrow: boolean; canCollateral: boolean;
  collateralRiskBps?: string | null; maxLtv?: string | null; liquidationThreshold?: string | null;
}
export interface CatalogMarket {
  id: string; chainId: number; version: ProtocolVersion; venue: Address;
  name: string; network: string; isTestnet: boolean; reserves: CatalogReserve[];
}
export interface MarketCatalog { markets: CatalogMarket[]; errors: string[] }
export type ComparisonMarket = Market & { catalog?: CatalogMarket; executionMarketId?: string };

export function comparisonMarkets(native: Market[], catalog: CatalogMarket[], chainId: number): ComparisonMarket[] {
  const sourceChainId = chainId === 31337 ? 1 : chainId;
  catalog = catalog.filter(market => market.chainId === sourceChainId);
  native = native.filter(market => market.chainId === chainId);
  const rows: ComparisonMarket[] = catalog.map(item => {
    const match = native.find(market => market.version === item.version && item.venue.toLowerCase() === market.venue.toLowerCase());
    const dynamic = chainId === 31337 && item.chainId === 1 && !item.isTestnet;
    return {
      ...match, id: item.id, chainId, version: item.version, venue: item.venue,
      name: match?.name ?? item.name, network: item.network, assets: catalogAssets([item], chainId),
      status: match?.status ?? 'unavailable', catalog: item, executionMarketId: match?.id ?? (dynamic ? `${chainId}/v${item.version}/${item.venue.toLowerCase()}` : undefined),
      reason: match?.reason ?? (match || dynamic ? undefined : 'This market is not available on the selected network.'),
    };
  });
  return rows;
}

/** One picker entry per token, independent of the pool/spoke reserve identity. */
export function catalogAssets(markets: CatalogMarket[], chainId: number, kind?: 'collateral' | 'debt'): Asset[] {
  const sourceChainId = chainId === 31337 ? 1 : chainId;
  const assets = new Map<string, Asset>();
  for (const market of markets) {
    if (market.chainId !== sourceChainId) continue;
    for (const reserve of market.reserves) {
      if ((kind === 'debt' && !reserve.canBorrow) || (kind === 'collateral' && (!reserve.canSupply || !reserve.canCollateral))) continue;
      if (!Number.isInteger(reserve.decimals)) continue;
      const id = `${chainId}/${reserve.address.toLowerCase()}`;
      if (!assets.has(id)) assets.set(id, { id, tokenId: id, address: reserve.address as Address, symbol: reserve.symbol, name: reserve.name ?? reserve.symbol, decimals: reserve.decimals, icon: reserve.icon });
    }
  }
  return [...assets.values()];
}

export function filterComparisonMarkets(markets: ComparisonMarket[], version: 'all' | 3 | 4, debt?: Asset, collaterals: Array<{ asset?: Asset; enabled: boolean }> = []): ComparisonMarket[] {
  return markets.filter(market => {
    if (version !== 'all' && market.version !== version) return false;
    if (!market.catalog) return false;
    const reserves = market.catalog.reserves;
    if (debt && !reserves.some(reserve => reserve.address.toLowerCase() === debt.address.toLowerCase() && reserve.canBorrow)) return false;
    return collaterals.every(({ asset, enabled }) => asset && reserves.some(reserve => reserve.address.toLowerCase() === asset.address.toLowerCase() && reserve.canSupply && (!enabled || reserve.canCollateral)));
  });
}

export interface IndexedMarketRate { marketId: string; reserveId?: string; borrowRateRay?: string; borrowApy: string | null; observedAt: string }
export interface IndexedMarketRates { rates: IndexedMarketRate[]; errors: string[] }

const validRate = (value: string | null | undefined): value is string => value != null && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0;

/** Bind both pricing and APY to the same debt reserve, honoring local Hub choices. */
function comparisonDebtReserve(market: ComparisonMarket, debt: Asset | undefined, rates: IndexedMarketRate[]) {
  if (!debt || !market.catalog) return undefined;
  const candidates = market.catalog.reserves.filter(reserve => reserve.address.toLowerCase() === debt.address.toLowerCase() && reserve.canBorrow && (!market.preferredDebtReserveIds?.length || market.preferredDebtReserveIds.includes(reserve.reserveId ?? '')))
    .map(reserve => {
      const indexed = rates.find(rate => rate.marketId === market.catalog!.id && rate.reserveId === reserve.reserveId && validRate(rate.borrowApy));
      return { reserve, rate: indexed?.borrowApy ?? null, rateRay: indexed?.borrowRateRay };
    });
  return candidates.filter(candidate => candidate.rate !== null).sort((a, b) => Number(a.rate) - Number(b.rate))[0] ?? (candidates.length === 1 ? candidates[0] : undefined);
}

export function comparisonBorrowApy(market: ComparisonMarket, debt: Asset | undefined, rates: IndexedMarketRate[]): string | null {
  return comparisonDebtReserve(market, debt, rates)?.rate ?? null;
}

export function comparisonBorrowRateRay(market: ComparisonMarket, debt: Asset | undefined, rates: IndexedMarketRate[]): string | undefined {
  return comparisonDebtReserve(market, debt, rates)?.rateRay;
}

/** Execute the same V4 reserve used for the displayed rate, including multi-Hub Spokes. */
export function bindBorrowRequest(request: BorrowRequest | null, market: ComparisonMarket | undefined, debt: Asset | undefined, rates: IndexedMarketRate[]): BorrowRequest | null {
  if (!request || market?.version !== 4 || !market.executionMarketId || !debt) return request;
  const reserve = comparisonDebtReserve(market, debt, rates)?.reserve;
  if (reserve?.reserveId == null) return request;
  return { ...request, debt: { ...request.debt, assetId: `${market.executionMarketId}/${reserve.reserveId}/${debt.address.toLowerCase()}` } };
}

export function rankComparisonMarkets(markets: ComparisonMarket[], debt: Asset | undefined, rates: IndexedMarketRate[]): ComparisonMarket[] {
  return markets.map(market => ({ market, rate: comparisonBorrowApy(market, debt, rates) }))
    .sort((a, b) => (a.rate === null ? Infinity : Number(a.rate)) - (b.rate === null ? Infinity : Number(b.rate)) || a.market.name.localeCompare(b.market.name) || a.market.id.localeCompare(b.market.id))
    .map(({ market }) => market);
}

export function catalogAmountUsd(markets: CatalogMarket[], chainId: number, asset: Asset | undefined, amount: string): number | null {
  if (!asset || !Number.isFinite(Number(amount))) return null;
  const sourceChainId = chainId === 31337 ? 1 : chainId;
  const price = markets.filter(market => market.chainId === sourceChainId).flatMap(market => market.reserves)
    .find(reserve => reserve.address.toLowerCase() === asset.address.toLowerCase() && reserve.usdPrice != null && reserve.usdPrice.trim() !== '' && Number.isFinite(Number(reserve.usdPrice)) && Number(reserve.usdPrice) > 0)?.usdPrice;
  const value = price == null ? null : Number(amount) * Number(price);
  return value !== null && Number.isFinite(value) ? value : null;
}

export interface MarketRiskEstimate extends RiskMetrics { maxLtv: string | null }
export interface EstimateCollateral { asset?: Asset; amount: string; enabled: boolean }
const numeric = (value: string | null | undefined) => value != null && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;
const ratio = (value: string | null | undefined) => { const parsed = numeric(value); return parsed !== null && parsed <= 1 ? parsed : null; };

/** Informational new-position estimate, using each market's own indexed oracle and risk settings. */
export function estimateMarketRisk(market: ComparisonMarket, inputs: EstimateCollateral[], debt: Asset | undefined, debtAmount: string, rates: IndexedMarketRate[]): MarketRiskEstimate {
  const result: MarketRiskEstimate = { ltv: null, healthFactor: null, maxLtv: null, collateralUsd: null, debtUsd: null, borrowCapacityUsd: null };
  const enabled = inputs.filter(input => input.enabled);
  if (!market.catalog || !enabled.length) return result;
  const collaterals = enabled.map(input => {
    const matches = market.catalog!.reserves.filter(reserve => reserve.address.toLowerCase() === input.asset?.address.toLowerCase() && reserve.canCollateral && reserve.canSupply);
    return { input, reserve: matches.length === 1 ? matches[0] : undefined };
  });
  if (collaterals.length === 1) result.maxLtv = ratio(collaterals[0].reserve?.maxLtv)?.toString() ?? null;
  if (collaterals.some(({ input, reserve }) => !reserve || numeric(input.amount) === null || Number(input.amount) <= 0 || numeric(reserve.usdPrice) === null || Number(reserve.usdPrice) <= 0)) return result;
  const values = collaterals.map(({ input, reserve }) => ({ value: Number(input.amount) * Number(reserve!.usdPrice), maxLtv: ratio(reserve!.maxLtv), threshold: ratio(reserve!.liquidationThreshold) }));
  const collateralUsd = values.reduce((sum, item) => sum + item.value, 0);
  if (!Number.isFinite(collateralUsd) || collateralUsd <= 0) return result;
  result.collateralUsd = collateralUsd.toString();
  const capacity = values.every(item => item.maxLtv !== null) ? values.reduce((sum, item) => sum + item.value * item.maxLtv!, 0) : null;
  if (capacity !== null) result.maxLtv = (capacity / collateralUsd).toString();
  const debtReserve = comparisonDebtReserve(market, debt, rates)?.reserve;
  const debtPrice = numeric(debtReserve?.usdPrice);
  const amount = numeric(debtAmount);
  if (debtPrice === null || debtPrice <= 0 || amount === null || amount <= 0) return result;
  const debtUsd = amount * debtPrice;
  if (!Number.isFinite(debtUsd) || debtUsd <= 0) return result;
  result.debtUsd = debtUsd.toString();
  result.ltv = (debtUsd / collateralUsd).toString();
  const adjustedCollateral = values.every(item => item.threshold !== null) ? values.reduce((sum, item) => sum + item.value * item.threshold!, 0) : null;
  if (adjustedCollateral !== null) result.healthFactor = (adjustedCollateral / debtUsd).toString();
  if (capacity !== null) result.borrowCapacityUsd = Math.max(0, capacity - debtUsd).toString();
  return result;
}

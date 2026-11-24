import type { CatalogMarket, IndexedMarketRates } from './market-catalog.ts';
import { aaveGraphql } from './server-market-catalog.ts';

/** Batch only the debt reserves in the markets remaining after UI filters. */
export function createIndexedMarketRatesLoader(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { expires: number; value: Promise<IndexedMarketRates> }>();
  return async (markets: CatalogMarket[], debtAddress: string): Promise<IndexedMarketRates> => {
    const candidates = markets.flatMap(market => market.reserves
      .filter(reserve => reserve.canBorrow && reserve.address.toLowerCase() === debtAddress.toLowerCase())
      .map(reserve => ({ market, reserve })));
    if (!candidates.length) return { rates: [], errors: [] };
    const key = candidates.map(({ market, reserve }) => `${market.id}/${reserve.reserveId ?? ''}/${reserve.address.toLowerCase()}`).sort().join(',');
    for (const [oldKey, entry] of cache) if (entry.expires <= Date.now()) cache.delete(oldKey);
    const active = cache.get(key);
    if (active) return active.value;
    const value = (async (): Promise<IndexedMarketRates> => {
      const results = await Promise.allSettled(([3, 4] as const).map(async version => {
        const selected = candidates.filter(candidate => candidate.market.version === version);
        if (!selected.length) return [];
        const variables: Record<string, unknown> = {};
        selected.forEach(({ market, reserve }, index) => {
          variables[`r${index}`] = version === 3
            ? { chainId: market.chainId, market: market.venue, underlyingToken: reserve.address }
            : { query: { reserveInput: { chainId: market.chainId, spoke: market.venue, onChainId: reserve.reserveId } } };
        });
        const query = `query FilteredBorrowRates(${selected.map((_, index) => `$r${index}: ReserveRequest!`).join(', ')}) {
          ${selected.map((_, index) => `q${index}: reserve(request: $r${index}) { ${version === 3 ? 'underlyingToken { address } borrowInfo { apy { value } }' : 'onChainId asset { underlying { address } } summary { borrowApy { value } }'} }`).join('\n')}
        }`;
        interface Result { underlyingToken?: { address: string }; borrowInfo?: { apy: { value: string } }; onChainId?: string; asset?: { underlying: { address: string } }; summary?: { borrowApy: { value: string } } }
        const data = await aaveGraphql<Record<string, Result | null>>(version, query, variables, fetcher);
        const observedAt = new Date().toISOString();
        return selected.map(({ market, reserve }, index) => {
          const result = data[`q${index}`];
          const address = result?.underlyingToken?.address ?? result?.asset?.underlying.address;
          const raw = version === 3 ? result?.borrowInfo?.apy.value : result?.summary?.borrowApy.value;
          const valid = address?.toLowerCase() === reserve.address.toLowerCase() && (version === 3 || result?.onChainId === reserve.reserveId) && raw != null && raw.trim() !== '' && Number.isFinite(Number(raw)) && Number(raw) >= 0;
          return { marketId: market.id, reserveId: reserve.reserveId, borrowApy: valid ? raw! : null, observedAt };
        });
      }));
      const response: IndexedMarketRates = { rates: [], errors: [] };
      results.forEach((result, index) => {
        if (result.status === 'fulfilled') response.rates.push(...result.value);
        else response.errors.push(`Aave V${index + 3} borrowing rates are unavailable. Try refreshing.`);
      });
      return response;
    })();
    const entry = { expires: Infinity, value };
    cache.set(key, entry);
    try { const result = await value; entry.expires = Date.now() + (result.errors.length ? 0 : 15_000); return result; }
    catch (error) { cache.delete(key); throw error; }
  };
}

export const getIndexedMarketRates = createIndexedMarketRatesLoader();

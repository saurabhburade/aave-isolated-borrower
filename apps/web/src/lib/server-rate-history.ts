import type { CatalogMarket } from './market-catalog.ts';
import { aaveGraphql } from './server-market-catalog.ts';
import { normalizeHistory, rateFromApy, type HistoryWindow, type RateHistory, type RatePoint, type RateSeries } from './rate-history.ts';

const ENDPOINTS = { 3: 'https://api.v3.aave.com/graphql', 4: 'https://api.v4.aave.com/graphql' } as const;
type ApiSample = { date: string; avgRate: { value: string } };
type HistoryProviderResult = { borrowAPYHistory?: ApiSample[]; borrowApyHistory?: ApiSample[] };

function apiPoints(samples: ApiSample[] | undefined): RatePoint[] {
  if (!Array.isArray(samples)) throw new Error('Invalid history response.');
  if (samples.length > 4096) throw new Error('History sample limit exceeded.');
  return samples.map(sample => {
    const value = sample.avgRate?.value;
    if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid historical rate.');
    return rateFromApy(Date.parse(sample.date) / 1000, Number(value));
  });
}

function providerWindow(window: HistoryWindow, version: 3 | 4): string {
  return window === '90d' && version === 4 ? 'LAST_THREE_MONTHS'
    : { '1d': 'LAST_DAY', '7d': 'LAST_WEEK', '30d': 'LAST_MONTH', '90d': 'LAST_SIX_MONTHS' }[window];
}

/** Load each matching pool/spoke debt reserve independently so one failure cannot hide other markets. */
export function createRateHistoryLoader(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { expires: number; value: Promise<RateSeries> }>();
  return async (window: HistoryWindow, markets: CatalogMarket[], debtAddress: string, sourceChainId = 1): Promise<RateHistory> => {
    const now = Math.floor(Date.now() / 1000);
    const from = now - { '1d': 1, '7d': 7, '30d': 30, '90d': 90 }[window] * 86400;
    for (const [key, entry] of cache) if (entry.expires <= Date.now()) cache.delete(key);
    const candidates = markets.filter(market => market.chainId === sourceChainId).flatMap(market => {
      const reserves = market.reserves.filter(reserve => reserve.canBorrow && reserve.address.toLowerCase() === debtAddress.toLowerCase());
      return reserves.map(reserve => ({ market, reserve, multiple: reserves.length > 1 }));
    });
    const series = await Promise.all(candidates.map(({ market, reserve, multiple }) => {
      const id = market.version === 3 ? market.id : `${market.id}/${reserve.reserveId}`;
      const label = `${market.name}${multiple ? ` · Reserve ${reserve.reserveId}` : ''}`;
      const definition: RateSeries = {
        id, label, venue: market.name, source: ENDPOINTS[market.version], points: [],
        detail: `${market.network} ${reserve.symbol} · ${market.version === 3 ? 'indexed borrow APY' : 'base borrow APY, rewards excluded; collateral risk premium is additional'}`,
      };
      const key = JSON.stringify([window, sourceChainId, id, debtAddress.toLowerCase()]);
      const previous = cache.get(key);
      if (previous) return previous.value.then(result => ({ ...result, label, detail: definition.detail }));
      const value = (async (): Promise<RateSeries> => {
        try {
          let result: HistoryProviderResult;
          if (market.version === 3) {
            result = await aaveGraphql<HistoryProviderResult>(3, 'query($request:BorrowAPYHistoryRequest!){borrowAPYHistory(request:$request){date avgRate{value}}}', {
              request: { chainId: sourceChainId, market: market.venue, underlyingToken: reserve.address, window: providerWindow(window, 3) },
            }, fetcher);
          } else {
            if (!reserve.reserveId) throw new Error('Debt reserve identity unavailable.');
            const lookup = await aaveGraphql<{ reserve: { id: string; onChainId: string; asset: { underlying: { address: string } } } | null }>(4,
              'query($request:ReserveRequest!){reserve(request:$request){id onChainId asset{underlying{address}}}}', {
                request: { query: { reserveInput: { chainId: sourceChainId, spoke: market.venue, onChainId: reserve.reserveId } } },
              }, fetcher);
            if (!lookup.reserve || lookup.reserve.onChainId !== reserve.reserveId || lookup.reserve.asset.underlying.address.toLowerCase() !== debtAddress.toLowerCase()) throw new Error('Debt reserve identity mismatch.');
            result = await aaveGraphql<HistoryProviderResult>(4, 'query($request:BorrowApyHistoryRequest!){borrowApyHistory(request:$request){date avgRate{value}}}', {
              request: { reserve: lookup.reserve.id, window: providerWindow(window, 4), includeRewards: false },
            }, fetcher);
          }
          const points = normalizeHistory(apiPoints(market.version === 3 ? result.borrowAPYHistory : result.borrowApyHistory), from, now);
          return points.length < 2 ? { ...definition, error: 'History unavailable' } : { ...definition, points };
        } catch {
          return { ...definition, error: 'History unavailable' };
        }
      })();
      const entry = { expires: Infinity, value };
      cache.set(key, entry);
      return value.then(result => {
        entry.expires = Date.now() + (result.error ? 0 : 300_000);
        if (cache.size > 500) cache.delete(cache.keys().next().value!);
        return result;
      });
    }));
    return { sourceChainId, from, to: now, fetchedAt: now, series };
  };
}

export const getRateHistory = createRateHistoryLoader();

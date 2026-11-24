'use client';

import { useCallback, useEffect, useState } from 'react';
import type { BorrowRequest, Market, MarketQuote, Position, Freshness, ReviewPlan, CreationDeployment } from '@/lib/domain';
import { useAccount, useChainId } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import type { MarketCatalog, IndexedMarketRates } from '@/lib/market-catalog';
import type { HistoryWindow, RateHistory } from '@/lib/rate-history';

const unavailable: Freshness = { status: 'unavailable', observedAt: null, blockNumber: null, reason: 'Native protocol data is not available yet.' };

export class ProtocolDataError extends Error {
  constructor(message: string, readonly code?: string) { super(message); }
}

async function readJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: 'no-store', headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ProtocolDataError(typeof body?.error === 'string' ? body.error : 'Native data request failed.', typeof body?.code === 'string' ? body.code : undefined);
  return body as T;
}

// Keep browsing responses across route unmounts without changing wallet query defaults.
const browseCache = { gcTime: 30 * 60_000, retry: false } as const;
const liveStaleTime = 30_000;
const catalogStaleTime = 5 * 60_000;

function requestFreshness(freshness: Freshness | undefined, error: Error | null): Freshness {
  if (!error) return freshness ?? unavailable;
  return { ...(freshness ?? unavailable), status: freshness && freshness.status !== 'unavailable' ? 'stale' : 'unavailable', reason: error.message };
}

export function useMarkets(chainId: number) {
  const query = useQuery({
    ...browseCache,
    queryKey: ['protocol', 'markets', chainId],
    queryFn: ({ signal }) => readJson<{ markets: Market[]; assets?: Market['assets']; freshness: Freshness; creationDeployment?: CreationDeployment | null }>(`/api/markets?chainId=${chainId}&summary=true`, { signal }),
    staleTime: liveStaleTime,
  });
  return {
    markets: query.data?.markets ?? [],
    creationDeployment: query.data?.creationDeployment ?? null,
    assets: query.data?.assets ?? query.data?.markets.flatMap(market => market.assets) ?? [],
    freshness: requestFreshness(query.data?.freshness, query.error),
    loading: query.isLoading,
    refreshing: query.isFetching,
    refresh: query.refetch,
  };
}

export function useQuotes(chainId: number, request: BorrowRequest | null, context?: { owner?: `0x${string}`; salt?: `0x${string}` | null }, marketId?: string) {
  const [quotes, setQuotes] = useState<MarketQuote[]>([]);
  const [reviewPlan, setReviewPlan] = useState<ReviewPlan | null>(null);
  const [freshness, setFreshness] = useState<Freshness>(unavailable);
  const [loading, setLoading] = useState(false);
  const [resolvedKey, setResolvedKey] = useState('');
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision(value => value + 1), []);
  const requestKey = JSON.stringify(request);
  const currentKey = JSON.stringify([chainId, requestKey, context?.owner ?? null, context?.salt ?? null, marketId ?? null, revision]);
  const [debounced, setDebounced] = useState({ request, context, marketId, key: currentKey });
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced({ request, context, marketId, key: currentKey }), 350);
    return () => window.clearTimeout(timer);
  // The serialized key captures the request, selected market, owner and salt.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);
  useEffect(() => {
    const nextRequest = debounced.request;
    if (!nextRequest || nextRequest.chainId !== chainId || !nextRequest.collaterals.some(item => Number(item.amount) > 0) || !Number(nextRequest.debt.amount)) {
      setQuotes([]); setReviewPlan(null); setFreshness(unavailable); setLoading(false); return;
    }
    const controller = new AbortController();
    setLoading(true);
    readJson<{ quotes: MarketQuote[]; reviewPlan?: ReviewPlan; freshness: Freshness }>('/api/quotes', { method: 'POST', body: JSON.stringify({ ...nextRequest, owner: debounced.context?.owner, salt: debounced.context?.salt, marketId: debounced.marketId }), signal: AbortSignal.any([controller.signal, AbortSignal.timeout(90_000)]) })
      .then(value => { if (!controller.signal.aborted) {
        setQuotes(value.quotes); setReviewPlan(value.reviewPlan ?? null);
        setFreshness(value.quotes.length ? value.freshness : { ...unavailable, reason: value.freshness.reason ?? 'No quote is available for this market. Refresh to try again.' });
        setResolvedKey(debounced.key);
      } })
      .catch(error => { if (!controller.signal.aborted) { setQuotes([]); setReviewPlan(null); setFreshness({ ...unavailable, reason: error instanceof Error && error.name === 'TimeoutError' ? 'Position checks timed out. Refresh to try again.' : error instanceof Error ? error.message : unavailable.reason }); setResolvedKey(debounced.key); } })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [chainId, debounced]);
  return { quotes: resolvedKey === currentKey ? quotes : [], reviewPlan: resolvedKey === currentKey ? reviewPlan : null, freshness, refresh, loading: loading || Boolean(request && Number(request.debt.amount) > 0 && request.collaterals.some(row => Number(row.amount) > 0) && resolvedKey !== currentKey) };
}

export function usePositions(chainId: number, owner: string | null) {
  const query = useQuery({
    ...browseCache,
    queryKey: ['protocol', 'positions', chainId, owner?.toLowerCase() ?? null],
    queryFn: ({ signal }) => readJson<{ positions: Position[]; freshness: Freshness }>(`/api/positions?owner=${encodeURIComponent(owner!)}&chainId=${chainId}`, { signal }),
    enabled: Boolean(owner),
    // Always recheck positions on return, while showing the cached snapshot.
    staleTime: 0,
  });
  return {
    positions: owner ? query.data?.positions ?? [] : [],
    freshness: requestFreshness(owner ? query.data?.freshness : undefined, query.error),
    loading: Boolean(owner && query.isFetching),
    refresh: query.refetch,
  };
}

export function useWallet() {
  const { address, isConnected } = useAccount();
  return { account: isConnected ? address ?? null : null, chainId: useChainId() };
}

export function useMarketCatalog(chainId = 31337) {
  const query = useQuery({
    ...browseCache,
    queryKey: ['protocol', 'market-catalog', chainId],
    queryFn: ({ signal }) => readJson<MarketCatalog>(`/api/market-catalog?chainId=${chainId}`, { signal }),
    staleTime: catalogStaleTime,
  });
  return {
    markets: query.data?.markets ?? [],
    errors: query.error ? ['Market catalog is unavailable. Try refreshing.'] : query.data?.errors ?? [],
    loading: query.isLoading,
    refreshing: query.isFetching,
    refresh: query.refetch,
  };
}

export function useIndexedMarketRates(chainId: number, marketIds: string[], debtAddress?: string) {
  const idsKey = JSON.stringify([...marketIds].sort());
  const enabled = Boolean(debtAddress && marketIds.length);
  const query = useQuery({
    ...browseCache,
    queryKey: ['protocol', 'market-rates', chainId, debtAddress?.toLowerCase(), idsKey],
    queryFn: ({ signal }) => readJson<IndexedMarketRates>(`/api/market-rates?chainId=${chainId}&debtAddress=${encodeURIComponent(debtAddress!)}&marketIds=${encodeURIComponent(idsKey)}`, { signal }),
    enabled,
    staleTime: liveStaleTime,
  });
  return {
    rates: enabled ? query.data?.rates ?? [] : [],
    errors: query.error ? ['Borrowing rates are unavailable. Try refreshing.'] : query.data?.errors ?? [],
    loading: enabled && query.isLoading,
    refresh: () => { if (enabled) return query.refetch(); },
  };
}

export function useRateHistory(chainId: number, period: HistoryWindow, debtAddress: string | undefined, marketIds: string) {
  const enabled = Boolean(debtAddress && marketIds !== '[]');
  const query = useQuery({
    ...browseCache,
    queryKey: ['protocol', 'rate-history', chainId, period, debtAddress?.toLowerCase(), marketIds],
    queryFn: async ({ signal }) => {
      const data = await readJson<RateHistory & { chainId: number }>(`/api/rate-history/?${new URLSearchParams({ chainId: String(chainId), window: period, debtAddress: debtAddress!, marketIds })}`, { signal });
      if (data.chainId !== chainId) throw new Error('History network mismatch');
      return data;
    },
    enabled,
    staleTime: catalogStaleTime,
    refetchInterval: catalogStaleTime,
  });
  return { data: enabled ? query.data ?? null : null, error: query.data ? null : query.error?.message ?? null, loading: enabled && query.isLoading };
}

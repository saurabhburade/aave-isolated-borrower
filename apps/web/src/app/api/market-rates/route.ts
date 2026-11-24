import { getIndexedMarketRates } from '../../../lib/server-market-rates.ts';
import { getForkMarketRates } from '../../../lib/server-fork-market-rates.ts';
import { getMarketCatalog } from '../../../lib/server-market-catalog.ts';
import { localAddress } from '../../../lib/validation.ts';

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const chainId = Number(url.searchParams.get('chainId'));
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return Response.json({ error: 'A valid chain ID is required.' }, { status: 400 });
  try {
    const address = localAddress(url.searchParams.get('debtAddress'), 'debtAddress');
    const ids: unknown = JSON.parse(url.searchParams.get('marketIds') ?? '[]');
    if (!Array.isArray(ids) || ids.length > 100 || !ids.every(id => typeof id === 'string')) throw new Error('A list of up to 100 market IDs is required.');
    if (!ids.length) return Response.json({ rates: [], errors: [] });
    const catalog = await getMarketCatalog(chainId === 31337 ? 1 : chainId);
    const markets = catalog.markets.filter(market => ids.includes(market.id));
    const result = await (chainId === 31337 ? getForkMarketRates(markets, address) : getIndexedMarketRates(markets, address));
    return Response.json({ rates: result.rates, errors: [...catalog.errors, ...result.errors] }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Market rates are unavailable.' }, { status: 400 });
  }
}

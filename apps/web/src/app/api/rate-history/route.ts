import { historyWindows, type HistoryWindow } from '../../../lib/rate-history.ts';
import { getRateHistory } from '../../../lib/server-rate-history.ts';
import { getMarketCatalog } from '../../../lib/server-market-catalog.ts';
import { localAddress } from '../../../lib/validation.ts';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const chainId = Number(url.searchParams.get('chainId') ?? '31337');
  const window = url.searchParams.get('window') ?? '7d';
  const headers = { 'Cache-Control': 'no-store' };
  if (![1, 31337].includes(chainId) || !historyWindows.includes(window as HistoryWindow)) return Response.json({ error: 'Invalid history request.' }, { status: 400, headers });
  let debtAddress: string;
  let ids: string[];
  try {
    debtAddress = localAddress(url.searchParams.get('debtAddress'), 'debtAddress');
    const input: unknown = JSON.parse(url.searchParams.get('marketIds') ?? '[]');
    if (!Array.isArray(input) || input.length > 100 || !input.every(id => typeof id === 'string')) throw new Error('A list of up to 100 market IDs is required.');
    ids = input;
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : 'Invalid history request.' }, { status: 400, headers });
  }
  try {
    const catalog = ids.length ? await getMarketCatalog(1) : { markets: [], errors: [] };
    if (catalog.errors.length && !catalog.markets.length) throw new Error('Market catalog unavailable.');
    const markets = catalog.markets.filter(market => ids.includes(market.id));
    return Response.json({ chainId, debtAddress, ...(await getRateHistory(window as HistoryWindow, markets, debtAddress)) }, { headers });
  } catch {
    return Response.json({ error: 'Rate history is currently unavailable.' }, { status: 503, headers });
  }
}

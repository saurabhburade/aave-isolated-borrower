import { getMarketCatalog } from '../../../lib/server-market-catalog.ts';

export async function GET(request: Request): Promise<Response> {
  const chainId = Number(new URL(request.url).searchParams.get('chainId') ?? 31337);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) return Response.json({ error: 'A valid chain ID is required.' }, { status: 400 });
  return Response.json(await getMarketCatalog(chainId === 31337 ? 1 : chainId), { headers: { 'Cache-Control': 'no-store' } });
}

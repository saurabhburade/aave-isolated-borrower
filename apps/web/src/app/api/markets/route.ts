import { getMarkets, json, errorResponse } from '../../../lib/api.ts';

export async function GET(request: Request): Promise<Response> {
  try { return json(await getMarkets(new URL(request.url).searchParams.get('summary') === 'true')); } catch (error) { return errorResponse(error, 503); }
}

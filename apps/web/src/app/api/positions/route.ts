import { getPositions, json, errorResponse } from '../../../lib/api.ts';

export async function GET(request: Request): Promise<Response> {
  try {
    const url = new URL(request.url);
    return json(await getPositions(url.searchParams.get('owner'), url.searchParams.get('chainId')));
  } catch (error) { return errorResponse(error, 400); }
}

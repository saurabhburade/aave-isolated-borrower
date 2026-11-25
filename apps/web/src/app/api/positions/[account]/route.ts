import { getPosition, json, errorResponse } from '../../../../lib/api.ts';

export async function GET(request: Request, context: { params: Promise<{ account: string }> }): Promise<Response> {
  try {
    const { account } = await context.params;
    const url = new URL(request.url);
    return json(await getPosition(account, url.searchParams.get('owner'), url.searchParams.get('chainId')));
  } catch (error) { return errorResponse(error, 400); }
}

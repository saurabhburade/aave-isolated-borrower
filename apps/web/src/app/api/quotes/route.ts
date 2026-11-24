import { postQuotes, readJson, json, errorResponse } from '../../../lib/api.ts';

export async function POST(request: Request): Promise<Response> {
  try { return json(await postQuotes(await readJson(request))); } catch (error) { return errorResponse(error, 400); }
}

import { postPrepare, readJson, json, errorResponse } from '../../../lib/api.ts';

export async function POST(request: Request): Promise<Response> {
  try { return json(await postPrepare(await readJson(request))); } catch (error) { return errorResponse(error, 400); }
}

// Read-only upstream transport for a disposable Anvil fork. Never accepts signing
// or transaction submission; chain state and responses come from the source RPC.
import http from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';

const source = new URL(process.env.FORK_URL ?? 'https://eth.drpc.org');
if (!['https:', 'http:'].includes(source.protocol)) throw new Error('Expected an HTTP source RPC.');
const requestsPerSecond = Number(process.env.FORK_RPS ?? 4);
if (!Number.isFinite(requestsPerSecond) || requestsPerSecond <= 0 || requestsPerSecond > 100) throw new Error('FORK_RPS must be between 0 and 100.');
const port = Number(process.env.FORK_PROXY_PORT ?? 8558);
let tail = Promise.resolve();
let nextRequest = 0;
const allowed = (method) => typeof method === 'string' && (method.startsWith('eth_get') || ['eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_feeHistory', 'net_version', 'web3_clientVersion'].includes(method));
const error = (id, message, code = -32601) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

async function forward(call) {
  if (!allowed(call.method)) return error(call.id, 'Method unavailable on read-only fork transport.');
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await delay(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + 1000 / requestsPerSecond;
    const response = await fetch(source, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': 'aave-isolated-positions' }, body: JSON.stringify(call), signal: AbortSignal.timeout(30_000) });
    const body = await response.json();
    const limited = response.status === 429 || body.error?.code === 15;
    if (limited && attempt < 3) { await delay(1000 * 2 ** attempt); continue; }
    return body;
  }
}

const server = http.createServer(async (request, response) => {
  response.setHeader('content-type', 'application/json');
  if (request.method === 'GET' && request.url === '/health') { response.end('{"ready":true}'); return; }
  if (request.method !== 'POST') { response.writeHead(405).end(); return; }
  let raw = '';
  try {
    for await (const chunk of request) {
      raw += chunk;
      if (raw.length > 1_000_000) throw new Error('Request too large.');
    }
    const call = JSON.parse(raw);
    if (!call || Array.isArray(call) || typeof call !== 'object') throw new Error('Expected one JSON-RPC call.');
    const task = tail.then(() => forward(call));
    tail = task.catch(() => {});
    response.end(JSON.stringify(await task));
  } catch {
    response.end(JSON.stringify(error(null, 'Upstream read failed.', -32000)));
  }
});
server.listen(port, '127.0.0.1');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

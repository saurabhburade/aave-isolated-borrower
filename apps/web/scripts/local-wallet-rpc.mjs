import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const upstream = 'http://127.0.0.1:8557';

// OKX includes custom device headers that Anvil's CORS preflight rejects.
// Keep wallet-signed submissions available, but never expose unlocked accounts,
// node-side signing, or Anvil's state mutation methods through the wallet port.
function allowedMethod(method) {
  return typeof method === 'string'
    && (method.startsWith('eth_') || ['net_version', 'web3_clientVersion'].includes(method))
    && !['eth_accounts', 'eth_sendTransaction'].includes(method)
    && (!method.startsWith('eth_send') || method === 'eth_sendRawTransaction')
    && !method.startsWith('eth_sign');
}

export function createWalletRpcProxy(target = upstream) {
  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && !/^chrome-extension:\/\/[a-p]{32}$/.test(origin)) {
      response.writeHead(403).end('Origin not allowed');
      return;
    }
    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin, Access-Control-Request-Headers');
      response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
      const headers = (request.headers['access-control-request-headers'] ?? 'content-type').split(',').map((header) => header.trim()).filter(Boolean);
      if (headers.some((header) => !/^[a-z0-9-]+$/i.test(header))) {
        response.writeHead(400).end('Invalid preflight headers');
        return;
      }
      response.setHeader('Access-Control-Allow-Headers', headers.join(', '));
      response.setHeader('Access-Control-Allow-Private-Network', 'true');
      response.setHeader('Access-Control-Max-Age', '600');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }
    if (request.method === 'GET' && request.url === '/health') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ upstream: target }));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end('POST required');
      return;
    }

    let body;
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 1_000_000) {
          response.writeHead(413).end('Request too large');
          return;
        }
        chunks.push(chunk);
      }
      body = Buffer.concat(chunks);
      const rpc = JSON.parse(body.toString('utf8'));
      const calls = Array.isArray(rpc) ? rpc : [rpc];
      if (!calls.length || calls.some((call) => !allowedMethod(call?.method))) {
        response.writeHead(403).end('RPC method not allowed');
        return;
      }
    } catch {
      response.writeHead(400).end('Invalid JSON-RPC request');
      return;
    }

    try {
      const result = await fetch(target, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body,
        signal: AbortSignal.timeout(30_000),
      });
      const resultBody = Buffer.from(await result.arrayBuffer());
      response.writeHead(result.status, { 'content-type': 'application/json' }).end(resultBody);
    } catch {
      response.writeHead(502).end('Local fork unavailable on port 8557. Start it with pnpm fork.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createWalletRpcProxy();
  server.listen(8556, '127.0.0.1', () => console.log(`Local wallet RPC: http://127.0.0.1:8556 → ${upstream}`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));
}

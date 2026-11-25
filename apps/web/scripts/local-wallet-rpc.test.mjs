import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { test } from 'node:test';
import { createWalletRpcProxy } from './local-wallet-rpc.mjs';

const origin = 'chrome-extension://mcohilncbfahbmgdjkbpemcciiolgcge';
const call = (method, id = 1) => ({ jsonrpc: '2.0', id, method, params: [] });
async function listen(server, t) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { server.close(resolve); server.closeAllConnections(); }));
  return `http://127.0.0.1:${server.address().port}`;
}

test('wallet preflight and chain detection reach the selected fork, including batches', async (t) => {
  const forwarded = [];
  const backend = await listen(createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const payload = JSON.parse(raw);
    forwarded.push(payload);
    const result = (entry) => ({ jsonrpc: '2.0', id: entry.id, result: '0x7a69' });
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(Array.isArray(payload) ? payload.map(result) : result(payload)));
  }), t);
  const proxy = await listen(createWalletRpcProxy(backend), t);
  const preflight = await fetch(proxy, { method: 'OPTIONS', headers: { origin, 'access-control-request-headers': 'content-type, device-token' } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.match(preflight.headers.get('access-control-allow-headers'), /device-token/);
  const otherWalletOrigin = 'chrome-extension://nkbihfbeogaeaoehlefnkodbefgpgknn';
  const otherWallet = await fetch(proxy, { method: 'OPTIONS', headers: { origin: otherWalletOrigin } });
  assert.equal(otherWallet.status, 204);
  assert.equal(otherWallet.headers.get('access-control-allow-origin'), otherWalletOrigin);
  for (const payload of [call('eth_chainId'), [call('eth_chainId'), call('net_version', 2)], call('eth_sendRawTransaction')]) {
    const response = await fetch(proxy, { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal((Array.isArray(result) ? result[0] : result).result, '0x7a69');
    assert.deepEqual(forwarded.at(-1), payload);
  }
  for (const method of ['eth_accounts', 'eth_sendTransaction', 'eth_sendTransactionSync', 'eth_sendUnsignedTransaction', 'eth_sign', 'personal_sign', 'anvil_setBalance', 'evm_revert']) {
    const response = await fetch(proxy, { method: 'POST', body: JSON.stringify(call(method)) });
    assert.equal(response.status, 403);
  }
  assert.equal((await fetch(proxy, { method: 'POST', headers: { origin: 'https://example.com' }, body: JSON.stringify(call('eth_chainId')) })).status, 403);
  assert.equal((await fetch(proxy, { method: 'POST', body: '{' })).status, 400);
  assert.equal(forwarded.length, 3);
});

test('an unavailable fork gives an actionable error rather than an opaque fetch failure', async (t) => {
  const backend = createServer();
  const backendUrl = await listen(backend, t);
  await new Promise((resolve) => backend.close(resolve));
  const proxy = await listen(createWalletRpcProxy(backendUrl), t);
  const response = await fetch(proxy, { method: 'POST', body: JSON.stringify(call('eth_chainId')) });
  assert.equal(response.status, 502);
  assert.match(await response.text(), /pnpm fork/);
});

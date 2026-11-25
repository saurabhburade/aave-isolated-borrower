import assert from 'node:assert/strict';
import test from 'node:test';
import { createConfig, createStorage } from 'wagmi';
import { connect, disconnect, getWalletClient } from 'wagmi/actions';
import { defineChain, http } from 'viem';
import { ANVIL_ACCOUNT, anvilConnector } from './anvil-connector.ts';

const chain = defineChain({ id: 31337, name: 'Anvil', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8557'] } } });

test('Anvil Local connects, sends approvals and transactions, reconnects, and disconnects without an extension', async (t) => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Reflect.set(process.env, 'NODE_ENV', 'development');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { location: { hostname: '127.0.0.1' } } });
  t.after(() => {
    if (previousEnvironment === undefined) Reflect.deleteProperty(process.env, 'NODE_ENV');
    else Reflect.set(process.env, 'NODE_ENV', previousEnvironment);
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow);
    else Reflect.deleteProperty(globalThis, 'window');
  });

  let chainId = '0x7a69';
  let accounts = [ANVIL_ACCOUNT];
  const calls: { method: string; params?: Record<string, string>[] }[] = [];
  const hash = `0x${'1'.repeat(64)}` as const;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    assert.equal(new URL(url).origin, 'http://127.0.0.1:8557');
    const body = JSON.parse(String(options.body));
    calls.push(body);
    const result = body.method === 'eth_chainId' ? chainId : body.method === 'eth_accounts' ? accounts : body.method === 'eth_sendTransaction' ? hash : null;
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  });
  const saved = new Map<string, string>();
  const storage = createStorage({ storage: { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => { saved.set(key, value); }, removeItem: (key) => { saved.delete(key); } } });
  const makeConfig = () => createConfig({ chains: [chain], connectors: [anvilConnector()], transports: { [chain.id]: http() }, storage, ssr: true, multiInjectedProviderDiscovery: false });
  const config = makeConfig();
  const connector = config.connectors[0];
  assert.equal(await connector.isAuthorized(), false, 'does not auto-connect before the user selects it');
  await connect(config, { connector });
  assert.deepEqual(await connector.getAccounts(), [ANVIL_ACCOUNT]);
  const wallet = await getWalletClient(config);
  assert.equal(await wallet.sendTransaction({ to: ANVIL_ACCOUNT, value: 0n }), hash);
  assert.equal(await wallet.writeContract({ address: ANVIL_ACCOUNT, abi: [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ type: 'address', name: 'spender' }, { type: 'uint256', name: 'amount' }], outputs: [{ type: 'bool' }] }], functionName: 'approve', args: [ANVIL_ACCOUNT, 1n] }), hash);
  const transactions = calls.filter((call) => call.method === 'eth_sendTransaction');
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].params?.[0].from.toLowerCase(), ANVIL_ACCOUNT.toLowerCase());
  assert(transactions[1].params?.[0].data.startsWith('0x095ea7b3'), 'approval reaches the real transaction path');
  for (const transaction of transactions) assert.equal(calls[calls.indexOf(transaction) - 1].method, 'eth_chainId', 'checks the node immediately before sending');

  const reloaded = makeConfig().connectors[0];
  assert.equal(await reloaded.isAuthorized(), true, 'reconnects after reload');
  await reloaded.disconnect();
  assert.equal(await reloaded.isAuthorized(), false);
  const provider = await connector.getProvider();
  await assert.rejects(provider.request({ method: 'eth_sendTransaction', params: [{ from: '0x0000000000000000000000000000000000000001', to: ANVIL_ACCOUNT }] }), /test account/);
  await assert.rejects(connector.switchChain!({ chainId: 1 }), /only supports chain 31337/);
  await assert.rejects(provider.request({ method: 'wallet_sendCalls', params: [{ calls: [], version: '2.0.0', atomicRequired: false }] }), /does not support/);

  chainId = '0x1';
  const submittedBefore = calls.filter((call) => call.method === 'eth_sendTransaction').length;
  await assert.rejects(wallet.sendTransaction({ to: ANVIL_ACCOUNT, value: 0n }), /chain 31337/);
  assert.equal(calls.filter((call) => call.method === 'eth_sendTransaction').length, submittedBefore);
  await assert.rejects(connector.connect(), /chain 31337/);
  chainId = '0x7a69';
  accounts = [];
  await assert.rejects(connector.connect(), /test account is unavailable/);
  accounts = [ANVIL_ACCOUNT];

  for (const [environment, hostname] of [['production', '127.0.0.1'], ['development', 'example.com']]) {
    Reflect.set(process.env, 'NODE_ENV', environment);
    window.location.hostname = hostname;
    const before = calls.length;
    await assert.rejects(connector.connect(), /development on localhost/);
    assert.equal(calls.length, before, 'blocked environments never contact the node');
  }
  Reflect.set(process.env, 'NODE_ENV', 'development');
  window.location.hostname = 'localhost';
  await disconnect(config);
  await assert.rejects(provider.request({ method: 'eth_accounts' }), /Connect Anvil Local/);
  assert.equal(await makeConfig().connectors[0].isAuthorized(), false);
});

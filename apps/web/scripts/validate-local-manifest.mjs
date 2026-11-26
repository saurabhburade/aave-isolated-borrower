import { readFile } from 'node:fs/promises';
import { keccak256, toHex } from 'viem';

const manifestPath = process.env.AAVE_DEPLOYMENT_MANIFEST ?? new URL('../../../contracts/config/local.json', import.meta.url);
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const rpc = manifest.rpcUrl;
if (manifest.chainId !== 31337 || !/^https?:\/\/(127\.0\.0\.1|localhost):8557$/.test(rpc)) throw new Error('Manifest must target local chain 31337 on RPC port 8557.');
async function rpcCall(method, params) {
  const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
}
const chainId = Number(BigInt(await rpcCall('eth_chainId', [])));
if (chainId !== 31337) throw new Error(`RPC chain is ${chainId}, expected 31337.`);
for (const [label, address, expected] of [['factory', manifest.factory, manifest.factoryCodeHash], ...manifest.markets.map((market) => [`${market.version}:${market.venue}`, market.venue, market.venueCodeHash])]) {
  const bytecode = await rpcCall('eth_getCode', [address, 'latest']);
  if (!bytecode || bytecode === '0x') throw new Error(`${label} has no bytecode.`);
  if (keccak256(bytecode) !== expected) throw new Error(`${label} bytecode hash mismatch.`);
}
console.log(JSON.stringify({ chainId, forkBlock: manifest.forkBlock, markets: manifest.markets.length, verified: true }));

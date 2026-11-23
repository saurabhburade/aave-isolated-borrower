import { setTimeout as delay } from 'node:timers/promises';

// A saved block environment can lag behind reserve updates in restored state.
// Move the local chain forward before serving interest-accruing protocol reads.
export async function restoreClock(request, now = Math.floor(Date.now() / 1000)) {
  if (await request('eth_chainId', []) !== '0x7a69') throw new Error('Clock recovery requires local chain 31337.');
  const before = await request('eth_getBlockByNumber', ['latest', false]);
  const target = BigInt(now);
  if (BigInt(before.timestamp) >= target) return false;
  await request('evm_setNextBlockTimestamp', [Number(target)]);
  await request('evm_mine', []);
  const after = await request('eth_getBlockByNumber', ['latest', false]);
  if (BigInt(after.timestamp) < target) throw new Error('Restored fork clock did not advance.');
  return true;
}

if (import.meta.main) {
  const rpcUrl = process.env.ANVIL_RPC_URL ?? 'http://127.0.0.1:8557';
  if (!/^http:\/\/(127\.0\.0\.1|localhost):8557$/.test(rpcUrl)) throw new Error('Clock recovery requires the local fork RPC.');
  const request = async (method, params) => {
    const response = await fetch(rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: AbortSignal.timeout(2000),
    });
    if (!response.ok) throw new Error(`Local RPC returned HTTP ${response.status}.`);
    const body = await response.json();
    if (body.error) throw new Error(body.error.message);
    return body.result;
  };
  console.log('Waiting for restored local fork before checking its clock...');
  let ready = false;
  for (let attempt = 0; attempt < 120; attempt++) {
    try { await request('eth_chainId', []); ready = true; break; }
    catch { await delay(500); }
  }
  if (!ready) throw new Error('Restored fork RPC did not become ready.');
  const advanced = await restoreClock(request);
  console.log(advanced ? 'Restored fork clock advanced to current time.' : 'Restored fork clock is current.');
}

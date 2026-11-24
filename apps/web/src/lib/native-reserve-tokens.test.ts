import test from 'node:test';
import assert from 'node:assert/strict';
import type { Address, PublicClient } from 'viem';
import { positionReserveTokens } from './native.ts';
import { manifestAsset } from './deployment.ts';

const account = '0x0000000000000000000000000000000000000011';
const pool = '0x0000000000000000000000000000000000000022';
const weth = '0x00000000000000000000000000000000000000aa';
const usdc = '0x00000000000000000000000000000000000000bb';
const disabledSupply = '0x00000000000000000000000000000000000000cc';
const market = { version: 3, venue: pool } as const;

function client(config: bigint, addresses: Record<number, Address>) {
  const reads: number[] = [];
  return { reads, client: { readContract: async (args: { functionName: string; args: readonly unknown[]; blockNumber: bigint }) => {
    assert.equal(args.blockNumber, 123n);
    if (args.functionName === 'getUserConfiguration') return config;
    assert.equal(args.functionName, 'getReserveAddressById');
    const id = Number(args.args[0]); reads.push(id);
    assert(id in addresses, 'unused reserves must not be scanned');
    return addresses[id];
  } } as unknown as PublicClient };
}

test('V3 position inventory reads only native active reserve IDs, including gaps in the reserve list', async () => {
  const f = client(2n | (1n << 6n), { 0: weth, 3: usdc });
  assert.deepEqual((await positionReserveTokens(f.client, market, account, [], 123n))?.sort(), [weth, usdc].sort());
  assert.deepEqual(f.reads.sort(), [0, 3]);
});

test('action history retains supplied assets when they are disabled as collateral', async () => {
  const f = client(2n, { 0: weth });
  const tokens = await positionReserveTokens(f.client, market, account, [disabledSupply, weth, weth.toUpperCase() as Address], 123n);
  assert.deepEqual(tokens?.sort(), [weth, disabledSupply].sort());
});

test('native configuration finds active assets even without matching account action events', async () => {
  const f = client(1n << 254n, { 127: usdc });
  assert.deepEqual(await positionReserveTokens(f.client, market, account, [weth], 123n), [weth, usdc]);
  assert.deepEqual(f.reads, [127]);
});

test('empty history and configuration fall back to complete inventory rather than declaring the account empty', async () => {
  const f = client(0n, {});
  assert.equal(await positionReserveTokens(f.client, market, account, ['0x0000000000000000000000000000000000000000'], 123n), undefined);
});

test('V4 retains complete native inventory', async () => {
  const f = client(0n, {});
  assert.equal(await positionReserveTokens(f.client, { ...market, version: 4 }, account, [weth], 123n), undefined);
  assert.equal(f.reads.length, 0);
});

test('V4 catalog assets retain full reserve-qualified identities for management selections', () => {
  const asset = manifestAsset({ ...market, version: 4, name: 'Spoke' }, { address: usdc, reserveId: '7', symbol: 'USDC', decimals: 6 });
  assert.equal(asset.id, `31337/v4/${pool}/7/${usdc}`);
});

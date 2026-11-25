import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient } from '@tanstack/react-query';
import { createBalanceBatcher, exceedsBalance, formatWalletBalance, walletBalanceKey, walletBalancePrefix } from './wallet-balances.ts';
import type { Address } from './domain.ts';

const owner = '0x0000000000000000000000000000000000000010';
const token = (n: number) => `0x${n.toString(16).padStart(40, '0')}` as Address;

test('overlapping lists share token queries and produce bounded multicalls', async () => {
  const client = new QueryClient();
  const batches: Address[][] = [];
  let active = 0;
  let peak = 0;
  const read = createBalanceBatcher(async (_chain, _owner, tokens) => {
    batches.push(tokens);
    peak = Math.max(peak, ++active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return tokens.map(address => BigInt(address));
  }, 64, 2);
  const loadBalance = (n: number) => client.fetchQuery({ queryKey: walletBalanceKey(31337, owner, token(n)), queryFn: () => read(31337, owner, token(n)), staleTime: 15_000 });
  const results = await Promise.all([...Array.from({ length: 200 }, (_, n) => loadBalance(n + 1)), loadBalance(1), loadBalance(100)]);
  assert.equal(results[199], 200n);
  assert.equal(results[200], 1n);
  assert.equal(batches.flat().length, 200);
  assert.equal(batches.length, 4);
  assert.ok(batches.every(batch => batch.length <= 64));
  assert.equal(peak, 2);
  await loadBalance(1);
  assert.equal(batches.length, 4, 'fresh cache prevents another RPC');
  await client.invalidateQueries({ queryKey: walletBalancePrefix(31337, owner) });
  await loadBalance(1);
  assert.equal(batches.length, 5, 'invalidation fetches a new balance');
  client.clear();
});

test('wallets and chains are isolated; address casing shares cache identity', async () => {
  assert.deepEqual(walletBalanceKey(1, owner, token(171).toUpperCase().replace('0X', '0x') as Address), walletBalanceKey(1, owner, token(171)));
  assert.notDeepEqual(walletBalanceKey(1, owner, token(1)), walletBalanceKey(31337, owner, token(1)));
  assert.notDeepEqual(walletBalanceKey(1, owner, token(1)), walletBalanceKey(1, token(20), token(1)));
  const calls: [number, Address, Address[]][] = [];
  const read = createBalanceBatcher(async (chain, account, tokens) => { calls.push([chain, account, tokens]); return tokens.map(() => 1n); });
  await Promise.all([read(1, owner, token(1)), read(31337, owner, token(1)), read(1, token(20), token(1))]);
  assert.equal(calls.length, 3);
});

test('individual token failures preserve successful balances, and RPC failures settle every token', async () => {
  const read = createBalanceBatcher(async () => [0n, new Error('Reverted'), 5n]);
  const results = await Promise.allSettled([read(1, owner, token(1)), read(1, owner, token(2)), read(1, owner, token(3))]);
  assert.deepEqual(results.map(result => result.status), ['fulfilled', 'rejected', 'fulfilled']);
  assert.deepEqual(results[0], { status: 'fulfilled', value: 0n });
  const broken = createBalanceBatcher(async () => { throw new Error('RPC down'); });
  const failures = await Promise.allSettled([broken(1, owner, token(1)), broken(1, owner, token(2))]);
  assert.ok(failures.every(result => result.status === 'rejected'));
  const short = createBalanceBatcher(async () => []);
  await assert.rejects(short(1, owner, token(1)), /unavailable/);
});

test('balance checks retain wei precision and do not round excess decimal places down', () => {
  assert.equal(exceedsBalance('1.000000000000000001', 18, 10n ** 18n), true);
  assert.equal(exceedsBalance('1', 18, 10n ** 18n), false);
  assert.equal(exceedsBalance('1.0000001', 6, 1_000_000n), true);
  assert.equal(exceedsBalance('.5', 6, 500_000n), false);
  assert.equal(exceedsBalance('9007199254740993', 0, 9007199254740992n), true);
  for (const input of ['', '.', '1.2.3']) assert.equal(exceedsBalance(input, 18, 0n), false);
  assert.equal(exceedsBalance('100', 18, undefined), false);
});

test('display distinguishes unavailable, zero, dust and large balances', () => {
  assert.equal(formatWalletBalance(undefined, 18), '—');
  assert.equal(formatWalletBalance(0n, 18), '0.00');
  assert.equal(formatWalletBalance(1n, 18), '<0.0001');
  assert.equal(formatWalletBalance(123456789n, 6), '123.4567');
  assert.equal(formatWalletBalance(9007199254740993n, 0), '9,007,199,254,740,993.00');
});

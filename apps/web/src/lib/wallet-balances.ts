import { formatUnits } from 'viem';
import type { Address } from './domain.ts';

export const BALANCE_REFRESH_MS = 15_000;
export const MULTICALL3_ADDRESS = '0xca11bde05977b3631167028862be2a173976ca11' as const;
export const walletBalancePrefix = (chainId: number, owner: Address) => ['wallet-balance', chainId, owner.toLowerCase()] as const;
export const walletBalanceKey = (chainId: number, owner: Address, token: Address) => [...walletBalancePrefix(chainId, owner), token.toLowerCase()] as const;

type ReadBatch = (chainId: number, owner: Address, tokens: Address[]) => Promise<(bigint | Error)[]>;
type PendingBalance = { token: Address; promise: Promise<bigint>; resolve: (value: bigint) => void; reject: (error: Error) => void };
type Group = { chainId: number; owner: Address; tokens: Map<string, PendingBalance> };

/** Query owns caching; this queue only combines concurrent reads and bounds RPC work. */
export function createBalanceBatcher(readBatch: ReadBatch, batchSize = 64, concurrency = 2) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || !Number.isInteger(concurrency) || concurrency < 1) throw new Error('Invalid balance batch limits.');
  const groups = new Map<string, Group>();
  let active = 0;
  let scheduled = false;

  const drain = () => {
    scheduled = false;
    while (active < concurrency && groups.size) {
      const [key, group] = groups.entries().next().value!;
      const entries: PendingBalance[] = [];
      for (const entry of group.tokens.values()) {
        entries.push(entry);
        if (entries.length === batchSize) break;
      }
      for (const entry of entries) group.tokens.delete(entry.token.toLowerCase());
      if (!group.tokens.size) groups.delete(key);
      active++;
      void Promise.resolve().then(() => readBatch(group.chainId, group.owner, entries.map(entry => entry.token)))
        .then(results => entries.forEach((entry, index) => {
          const value = results[index];
          if (typeof value === 'bigint') entry.resolve(value);
          else entry.reject(value ?? new Error('Wallet balance unavailable.'));
        }))
        .catch(error => entries.forEach(entry => entry.reject(error instanceof Error ? error : new Error('Wallet balance unavailable.'))))
        .finally(() => { active--; drain(); });
    }
  };

  return (chainId: number, owner: Address, token: Address): Promise<bigint> => {
    const key = `${chainId}:${owner.toLowerCase()}`;
    let group = groups.get(key);
    if (!group) { group = { chainId, owner, tokens: new Map() }; groups.set(key, group); }
    const existing = group.tokens.get(token.toLowerCase());
    if (existing) return existing.promise;
    let resolve!: PendingBalance['resolve'];
    let reject!: PendingBalance['reject'];
    const promise = new Promise<bigint>((accept, fail) => { resolve = accept; reject = fail; });
    group.tokens.set(token.toLowerCase(), { token, promise, resolve, reject });
    if (!scheduled) { scheduled = true; setTimeout(drain, 0); }
    return promise;
  };
}

/** Compare decimal input exactly, including fractional units that parseUnits would round. */
export function exceedsBalance(amount: string, decimals: number, balance: bigint | undefined): boolean {
  if (balance === undefined || !/^\d*\.?\d*$/.test(amount) || !/\d/.test(amount)) return false;
  const [whole = '', fraction = ''] = amount.split('.');
  const precision = Math.max(decimals, fraction.length);
  const entered = BigInt(whole || '0') * 10n ** BigInt(precision) + BigInt(fraction.padEnd(precision, '0') || '0');
  return entered > balance * 10n ** BigInt(precision - decimals);
}

export function formatWalletBalance(value: bigint | undefined, decimals: number): string {
  if (value === undefined) return '—';
  if (value === 0n) return '0.00';
  const formatted = formatUnits(value, decimals);
  const [whole, fraction = ''] = formatted.split('.');
  if (whole === '0' && Number(formatted) < 0.0001) return '<0.0001';
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.slice(0, 4).padEnd(2, '0')}`;
}

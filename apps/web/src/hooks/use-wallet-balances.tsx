'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { getPublicClient } from 'wagmi/actions';
import { useAccount, useConfig } from 'wagmi';
import { erc20Abi } from 'viem';
import type { Address, Asset } from '@/lib/domain';
import { BALANCE_REFRESH_MS, createBalanceBatcher, walletBalanceKey } from '@/lib/wallet-balances';

const BalanceReader = createContext<ReturnType<typeof createBalanceBatcher> | null>(null);
export type WalletBalance = { value: bigint | undefined; loading: boolean; error: boolean };

export function WalletBalancesProvider({ children }: { children: ReactNode }) {
  const config = useConfig();
  const queryClient = useQueryClient();
  const [read] = useState(() => createBalanceBatcher(async (chainId, owner, tokens) => {
    const client = getPublicClient(config, { chainId });
    if (!client) throw new Error('Wallet balance network unavailable.');
    const results = await client.multicall({
      contracts: tokens.map(address => ({ address, abi: erc20Abi, functionName: 'balanceOf' as const, args: [owner] as const })),
      allowFailure: true,
      batchSize: 4096,
    });
    return results.map(result => result.status === 'success' ? result.result : new Error('Token balance unavailable.'));
  }));

  // One timer for all active tokens, regardless of how many screens observe them.
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void queryClient.invalidateQueries({ queryKey: ['wallet-balance'], refetchType: 'active' });
    }, BALANCE_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [queryClient]);
  return <BalanceReader.Provider value={read}>{children}</BalanceReader.Provider>;
}

export function useWalletBalances(assets: readonly Asset[], chainId: number, enabled = true, owner?: Address) {
  const read = useContext(BalanceReader);
  if (!read) throw new Error('WalletBalancesProvider is required.');
  const { address } = useAccount();
  const account = owner ?? address;
  const tokens = useMemo(() => [...new Map(assets.map(asset => [asset.address.toLowerCase(), asset.address])).values()], [assets]);
  const queries = useQueries({ queries: tokens.map(token => ({
    queryKey: account ? walletBalanceKey(chainId, account, token) : ['wallet-balance', chainId, null, token.toLowerCase()],
    queryFn: () => read(chainId, account!, token),
    enabled: Boolean(enabled && account),
    staleTime: BALANCE_REFRESH_MS,
    retry: 1,
    refetchOnWindowFocus: true,
  })) });
  return new Map(tokens.map((token, index) => {
    const query = queries[index];
    return [token.toLowerCase(), {
      value: account ? query.data : undefined,
      loading: Boolean(enabled && account && query.isPending),
      error: Boolean(account && query.isError),
    } satisfies WalletBalance];
  }));
}

export function useWalletBalance(asset: Asset | undefined, chainId: number, enabled = true, owner?: Address): WalletBalance {
  const assets = useMemo(() => asset ? [asset] : [], [asset]);
  return useWalletBalances(assets, chainId, enabled, owner).get(asset?.address.toLowerCase() ?? '') ?? { value: undefined, loading: false, error: false };
}

'use client';

import { useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { connectorsForWallets, RainbowKitProvider, type Wallet } from '@rainbow-me/rainbowkit';
import { injectedWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, createConnector, WagmiProvider } from 'wagmi';
import { defineChain, http } from 'viem';
import { MotionProvider } from '@/components/ui/motion-provider';
import { WalletBalancesProvider } from '@/hooks/use-wallet-balances';
import { MULTICALL3_ADDRESS } from '@/lib/wallet-balances';
import { anvilConnector } from '@/lib/anvil-connector';

const localFork = defineChain({ id: 31337, name: 'Aave local fork', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: ['http://127.0.0.1:8556'] } }, contracts: { multicall3: { address: MULTICALL3_ADDRESS } } });
const anvilWallet = (): Wallet => ({
  id: 'anvilLocal',
  name: 'Anvil Local',
  iconUrl: '/wallets/anvil.svg',
  iconBackground: '#27272a',
  installed: true,
  hidden: () => typeof window !== 'undefined' && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname),
  createConnector: (walletDetails) => createConnector((config) => ({ ...anvilConnector()(config), ...walletDetails })),
});
// No WalletConnect client or project is created. Local signing is development-only.
const connectors = connectorsForWallets([
  ...(process.env.NODE_ENV === 'development' ? [{ groupName: 'Local development', wallets: [anvilWallet] }] : []),
  { groupName: 'Browser wallets', wallets: [injectedWallet] },
], { appName: 'Aave positions', projectId: '' });
const config = createConfig({ chains: [localFork], connectors, transports: { [localFork.id]: http('http://127.0.0.1:8557') }, ssr: true });

export function WalletProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  return <WagmiProvider config={config}><QueryClientProvider client={queryClient}><WalletBalancesProvider><MotionProvider><RainbowKitProvider>{children}</RainbowKitProvider></MotionProvider></WalletBalancesProvider></QueryClientProvider></WagmiProvider>;
}

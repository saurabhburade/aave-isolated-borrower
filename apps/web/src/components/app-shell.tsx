'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useAccount, useChainId, useSwitchChain } from 'wagmi';
import { useAccountModal, useConnectModal } from '@rainbow-me/rainbowkit';
import { Menu, Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { MotionButton as ReferenceButton } from '@/components/ui/motion-button';
import { MotionIcon } from '@/components/ui/motion-icon';
import { NetworkSelector } from '@/components/network-selector';
import { getNetwork } from '@/lib/networks';
import { BorrowWorkspace } from '@/components/borrow-workspace';
import { PositionsView } from '@/components/positions-view';
import { AppFooter } from '@/components/app-footer';
import { AboutView } from '@/components/about-view';

function WalletButton() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { openAccountModal } = useAccountModal();
  return <ReferenceButton static variant={isConnected ? 'secondary' : 'default'} size="sm" className="header-wallet" onClick={() => isConnected ? openAccountModal?.() : openConnectModal?.()}><span>{isConnected && address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Connect wallet'}</span></ReferenceButton>;
}

function ThemeButton() {
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.classList.contains('dark')); }, []);
  return <ReferenceButton variant="secondary" size="icon" aria-label="Toggle dark mode" onClick={() => { const next = !document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark', next); try { localStorage.setItem('aave-isolated-theme', next ? 'dark' : 'light'); } catch {} setDark(next); }}><MotionIcon icon={dark ? Sun : Moon} state={dark ? 'dark' : 'light'} /></ReferenceButton>;
}

function Header({ chainId, section }: { chainId: number; section: AppSection }) {
  const network = getNetwork(chainId)!;
  const wallet = useAccount(); const walletChain = useChainId(); const { switchChain } = useSwitchChain();
  const needsNetworkSwitch = wallet.isConnected && walletChain !== chainId;
  const links = [
    { section: 'borrow', href: `/${chainId}`, label: 'Borrow' },
    { section: 'positions', href: `/${chainId}/positions`, label: 'Positions' },
    { section: 'about', href: `/${chainId}/about`, label: 'About' },
  ] as const;
  return <header className="app-header"><div className="shell-inner">
    <nav className="primary-nav" aria-label="Primary navigation">
      <Link className="brand-link" href={`/${chainId}`} aria-label="Aave positions home"><img className="brand-mark" src="/brand/position-coins.png" width={28} height={28} alt="" /></Link>
      <div className="primary-nav-links">
        {links.map(link => <Link key={link.section} className="primary-nav-link" href={link.href} aria-current={section === link.section ? 'page' : undefined}>{link.label}</Link>)}
      </div>
    </nav>
    <div className="header-actions">
      <NetworkSelector network={network} section={section === 'about' ? 'about' : section === 'borrow' ? '' : 'positions'} />
      {needsNetworkSwitch ? <ReferenceButton className="header-switch-network" size="sm" onClick={() => switchChain({ chainId })}>Switch to Anvil</ReferenceButton> : null}
      <WalletButton /><ThemeButton />
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="secondary" size="icon" className="mobile-menu-trigger" />} aria-label="Open navigation menu"><Menu aria-hidden="true" /></DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={10} className="network-menu mobile-nav-menu">
          <DropdownMenuGroup>
            {links.map(link => <DropdownMenuItem key={link.section} className="network-menu-item" render={<Link href={link.href} />} aria-current={section === link.section ? 'page' : undefined}>{link.label}</DropdownMenuItem>)}
            {needsNetworkSwitch ? <DropdownMenuItem className="network-menu-item" onClick={() => switchChain({ chainId })}>Switch to Anvil</DropdownMenuItem> : null}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  </div></header>;
}

type AppSection = 'borrow' | 'positions' | 'about';

export function AppShell({ chainId, section }: { chainId: number; section: AppSection }) {
  return <div className="app-shell"><Header chainId={chainId} section={section} /><main className={section === 'borrow' ? 'workspace' : 'shell-content'}>{section === 'borrow' ? <BorrowWorkspace chainId={chainId} /> : section === 'about' ? <AboutView /> : <PositionsView chainId={chainId} />}</main><AppFooter /></div>;
}

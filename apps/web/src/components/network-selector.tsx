'use client';
import { useRouter } from 'next/navigation';
import { Check, ChevronDown, Globe } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { networks, type Network } from '@/lib/networks';

export function NetworkIcon({ network }: { network: Network }) {
  return network.logo ? <img className="network-icon" src={network.logo} alt="" width={18} height={18} /> : <Globe className="network-icon" aria-hidden="true" />;
}

export function NetworkSelector({ network, section = '' }: { network: Network; section?: '' | 'positions' | 'about' }) {
  const router = useRouter();
  return <DropdownMenu>
    <DropdownMenuTrigger render={<Button variant="secondary" size="sm" className="network-trigger" />} aria-label={`Select network, ${network.name}`}>
      <NetworkIcon network={network} /><span>{network.name}</span><ChevronDown className="network-chevron" />
    </DropdownMenuTrigger>
    <DropdownMenuContent align="end" sideOffset={10} className="network-menu">
      <DropdownMenuGroup>
        {networks.map((item) => <DropdownMenuItem key={item.id} className="network-menu-item" onClick={() => router.push(`/${item.id}/${section ? `${section}/` : ''}`)} aria-current={item.id === network.id ? 'page' : undefined}>
          <NetworkIcon network={item} /><span>{item.name}</span>{item.id === network.id ? <Check className="network-check" /> : null}
        </DropdownMenuItem>)}
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>;
}

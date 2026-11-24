'use client';
import { useMemo, useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Button } from '@/components/ui/button';
import type { Asset } from '@/lib/domain';
import { networks } from '@/lib/networks';
import { NetworkIcon } from './network-selector';
import { TokenMark } from './token-mark';
import { useWalletBalances } from '@/hooks/use-wallet-balances';
import { AssetPickerList } from './asset-picker-list';

// Assets and collateral eligibility from the Aave market catalog.
export function AssetPicker({ open, chainId, title, assets, selectedId, onSelect, onClose }: { open: boolean; chainId: number; title: string; assets: Asset[]; selectedId: string; onSelect: (asset: Asset) => void; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [chainQuery, setChainQuery] = useState('');
  const normalized = query.trim().toLowerCase();
  const balances = useWalletBalances(assets, chainId, open);
  const filtered = useMemo(() => assets.filter(asset => `${asset.symbol} ${asset.name} ${asset.address}`.toLowerCase().includes(normalized)), [assets, normalized]);
  const funded: Asset[] = [];
  const remaining: Asset[] = [];
  for (const asset of filtered) ((balances.get(asset.address.toLowerCase())?.value ?? 0n) > 0n ? funded : remaining).push(asset);
  const ranked = [...funded, ...remaining];
  const close = () => { setQuery(''); setChainQuery(''); onClose(); };
  const select = (asset: Asset) => { onSelect(asset); close(); };
  return <Dialog open={open} onOpenChange={next => { if (!next) close(); }}><DialogContent data-variant="asset-picker" showCloseButton={false} initialFocus={false}>
    <DialogTitle className="sr-only">{title}</DialogTitle><DialogDescription className="sr-only">Search Aave assets. Borrowing availability depends on the selected Aave market.</DialogDescription>
    <div className="picker-grid"><aside className="picker-chains"><div className="picker-searchbar"><InputGroup variant="picker"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput aria-label="Search chains" value={chainQuery} onChange={event => setChainQuery(event.target.value)} placeholder="Search chains" /></InputGroup></div><div className="picker-chain-options">{networks.filter(item => item.name.toLowerCase().includes(chainQuery.toLowerCase())).map(item => <button key={item.id} className="chain-option" aria-pressed="true" type="button"><NetworkIcon network={item} /><span>{item.name}</span><Check size={16} /></button>)}</div></aside>
      <section className="picker-tokens"><div className="picker-searchbar"><InputGroup variant="picker"><InputGroupAddon><Search /></InputGroupAddon><InputGroupInput aria-label="Search tokens or paste address" placeholder="Search tokens or paste address" value={query} onChange={event => setQuery(event.target.value)} /></InputGroup><DialogClose render={<Button variant="ghost" size="icon" />} aria-label="Close token picker"><X /></DialogClose></div>
        <div className="picker-popular"><p>Popular</p><div>{['USDC', 'USDT', 'DAI', 'WETH'].map(symbol => { const asset = assets.find(item => item.symbol === symbol); return asset ? <button key={asset.id} className="popular-token" type="button" onClick={() => select(asset)}><TokenMark token={asset.symbol} icon={asset.icon} />{asset.symbol}</button> : null; })}</div></div>
        <AssetPickerList key={normalized} assets={ranked} balances={balances} selectedId={selectedId} onSelect={select} />
      </section></div>
  </DialogContent></Dialog>;
}

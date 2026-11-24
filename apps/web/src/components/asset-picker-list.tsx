'use client';

import { useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { Asset } from '@/lib/domain';
import type { WalletBalance } from '@/hooks/use-wallet-balances';
import { formatWalletBalance } from '@/lib/wallet-balances';
import { Skeleton } from '@/components/ui/skeleton';
import { TokenMark } from './token-mark';

const ROW_HEIGHT = 56;
const OVERSCAN = 5;

export function AssetPickerList({ assets, balances, selectedId, onSelect }: {
  assets: Asset[]; balances: Map<string, WalletBalance>; selectedId: string; onSelect: (asset: Asset) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ top: 0, height: 390 });
  const [pendingFocus, setPendingFocus] = useState<number | null>(null);
  const virtual = assets.length > 100;
  const start = virtual ? Math.min(Math.max(0, assets.length - 1), Math.max(0, Math.floor(viewport.top / ROW_HEIGHT) - OVERSCAN)) : 0;
  const end = virtual ? Math.min(assets.length, Math.ceil((viewport.top + viewport.height) / ROW_HEIGHT) + OVERSCAN) : assets.length;

  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewport({ top: element.scrollTop, height: element.clientHeight }));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    if (pendingFocus !== null) {
      list.current?.querySelector<HTMLButtonElement>(`[data-index="${pendingFocus}"]`)?.focus({ preventScroll: true });
      setPendingFocus(null);
    }
  }, [pendingFocus]);

  const navigate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const row = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-index]');
    const element = list.current;
    if (!row || !element) return;
    event.preventDefault();
    const current = Number(row.dataset.index);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? assets.length - 1
      : Math.max(0, Math.min(assets.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)));
    // Keep focus inside the dialog while the previously focused row unmounts.
    element.focus({ preventScroll: true });
    if (index * ROW_HEIGHT < element.scrollTop) element.scrollTop = index * ROW_HEIGHT;
    else if ((index + 1) * ROW_HEIGHT > element.scrollTop + element.clientHeight - 16) element.scrollTop = (index + 1) * ROW_HEIGHT - element.clientHeight + 16;
    setViewport({ top: element.scrollTop, height: element.clientHeight });
    setPendingFocus(index);
  };

  return <div ref={list} className="picker-token-list" role="listbox" tabIndex={-1} aria-label="Supported Aave assets" onKeyDown={navigate}
    onScroll={virtual ? event => setViewport({ top: event.currentTarget.scrollTop, height: event.currentTarget.clientHeight }) : undefined}>
    {start > 0 ? <div role="presentation" style={{ height: start * ROW_HEIGHT }} /> : null}
    {assets.slice(start, end).map((asset, offset) => {
      const balance = balances.get(asset.address.toLowerCase());
      return <button key={asset.id} className="token-option" data-index={start + offset} role="option" aria-setsize={assets.length} aria-posinset={start + offset + 1}
        aria-selected={asset.id === selectedId} type="button" onClick={() => onSelect(asset)}>
        <TokenMark token={asset.symbol} icon={asset.icon} />
        <span className="token-option-label"><strong>{asset.symbol}</strong><small>{asset.name}</small></span>
        <span className="token-balance" title={balance?.error ? 'Wallet balance unavailable' : undefined}>
          {balance?.loading ? <Skeleton className="h-3 w-12" role="status" aria-label={`Loading ${asset.symbol} balance`} />
            : <span aria-label={`${asset.symbol} wallet balance`}>{formatWalletBalance(balance?.value, asset.decimals)}</span>}
        </span>
      </button>;
    })}
    {end < assets.length ? <div role="presentation" style={{ height: (assets.length - end) * ROW_HEIGHT }} /> : null}
    {!assets.length ? <p className="picker-no-match">No matching assets.</p> : null}
  </div>;
}

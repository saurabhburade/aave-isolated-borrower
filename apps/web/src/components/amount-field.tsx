'use client';
import { useWalletBalance } from '@/hooks/use-wallet-balances';
import { exceedsBalance, formatWalletBalance } from '@/lib/wallet-balances';
import type { Asset } from '@/lib/domain';
import { AmountPanel, AmountPanelSkeleton } from './amount-panel';

export function AmountField({ asset, chainId, label, value, usd = '0.00', loading = false, onChange, onAssetClick }: { asset?: Asset; chainId: number; label: string; value: string; usd?: string; loading?: boolean; onChange: (value: string) => void; onAssetClick: () => void }) {
  const balance = useWalletBalance(asset, chainId);
  const displayUsd = Number(value) === 0 ? '$0.00' : usd;
  const displayBalance = formatWalletBalance(balance.value, asset?.decimals ?? 18);
  if (loading && !asset) return <AmountPanelSkeleton label={label} />;
  return <AmountPanel token={asset?.symbol ?? 'Asset'} icon={asset?.icon} id={label.toLowerCase().replaceAll(' ', '-')} label={label} value={value} usd={displayUsd} balance={displayBalance} loading={balance.loading} invalid={Boolean(asset && label.startsWith('Collateral') && exceedsBalance(value, asset.decimals, balance.value))} onChange={next => onChange(next.replace(/[^0-9.]/g, ''))} onAssetClick={onAssetClick} />;
}

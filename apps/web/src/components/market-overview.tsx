import type { Asset } from '@/lib/domain';
import type { Network } from '@/lib/networks';
import { NetworkIcon } from './network-selector';
import { TokenMark } from './token-mark';
import { MorphingText } from './morphing-text';

export function MarketOverview({ network, collateral, debt, extraCollateral }: { network: Network; collateral?: Asset; debt?: Asset; extraCollateral: number }) {
  return <section className="market-overview" aria-label="Borrow market overview">
    <div className="market-pair-group">
      <div className="market-pair-icons" aria-hidden="true"><TokenMark token={collateral?.symbol ?? ''} icon={collateral?.icon} /><TokenMark token={debt?.symbol ?? ''} icon={debt?.icon} /></div>
      <div className="market-pair-copy"><strong><MorphingText text={`${collateral?.symbol ?? 'Collateral'}${extraCollateral ? ` +${extraCollateral}` : ''} / ${debt?.symbol ?? 'Debt'}`} /></strong><span><NetworkIcon network={network} /><MorphingText text={network.name} /></span></div>
    </div>
  </section>;
}

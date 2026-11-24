import type { Asset, CollateralInput, Market, MarketQuote } from '@/lib/domain';
import { cn, formatAmount, getHealthFactorColor, shortAddress } from '@/lib/utils';
import { ProtocolMark } from './protocol-mark';

// Reference diagram primitives, adapted to exactly one owner-controlled account.
export function RoutingDiagram({ collateral, assets, debt, debtAsset, market, quote }: { collateral: CollateralInput[]; assets: Asset[]; debt: string; debtAsset?: Asset; market: Market; quote: MarketQuote }) {
  const basket = collateral.filter(item => Number(item.amount) > 0).map(item => `${formatAmount(item.amount)} ${assets.find(asset => asset.id === item.assetId)?.symbol ?? ''}`).join(' + ');
  const account = shortAddress(quote.account);
  const apy = quote.borrowApy ? `${(Number(quote.borrowApy) * 100).toFixed(2)}% APY` : 'APY unavailable';
  return <><svg className="routing-diagram" viewBox="0 0 720 165" role="img" aria-label="Position account flow"><title>Position account flow</title><desc>Collateral enters one dedicated account on the selected Aave venue. Borrowed assets go to its owner.</desc>
    <text x="24" y="30" className="route-endpoint">Collateral basket</text><text x="696" y="30" textAnchor="end" className="route-endpoint">Owner receives {formatAmount(debt)} {debtAsset?.symbol}</text>
    <path className="route-wire route-trunk" d="M24 55 V90 M696 55 V90" />
    <path className="route-wire" d="M24 90 Q24 106 40 106 H360 M360 106 H680 Q696 106 696 90" /><path className="route-arrow" d="M248 102 l5 4 -5 4 M632 102 l5 4 -5 4" />
    <foreignObject x="40" y="94" width="206" height="28"><div className="route-label-wrap"><span className="route-label-badge" title={basket}>{basket}</span></div></foreignObject>
    <foreignObject x="260" y="89" width="200" height="34"><div className="route-node-wrap"><div className="route-node-label"><ProtocolMark venue={market.name} /><span>{account}</span></div></div></foreignObject>
    <foreignObject x="464" y="94" width="170" height="28"><div className="route-label-wrap"><span className="route-label-badge">{formatAmount(debt)} {debtAsset?.symbol}</span></div></foreignObject>
    <text x="360" y="145" textAnchor="middle" className="route-rate">{market.version === 3 ? 'V3 Pool' : 'V4 Spoke'} · {apy} · <tspan className={cn('hf-value', getHealthFactorColor(quote.risk.healthFactor))}>HF {formatAmount(quote.risk.healthFactor, 2)}</tspan></text><circle cx="24" cy="55" r="4" className="route-dot" /><circle cx="696" cy="55" r="4" className="route-dot" />
  </svg><div className="routing-compact"><div className="compact-endpoints"><span>{basket}</span><span>{formatAmount(debt)} {debtAsset?.symbol}</span></div><div className="compact-branches"><div className="compact-route"><span className="compact-node"><span className="compact-platform"><ProtocolMark venue={market.name} /><strong>{account}</strong></span><small>One {market.version === 3 ? 'Pool' : 'Spoke'}</small></span><span className="compact-arrow" aria-hidden="true">→</span><span className="compact-debt">Owner<small>{apy}</small></span></div></div></div></>;
}

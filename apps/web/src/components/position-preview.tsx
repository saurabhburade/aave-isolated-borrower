'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { AnimatedNumber } from './animated-number';
import { TooltipProvider } from '@/components/ui/tooltip';
import { InfoTip } from '@/components/ui/info-tip';
import { Heart } from 'lucide-react';
import type { Asset, Market, MarketQuote, RiskMetrics } from '@/lib/domain';
import { cn, formatAmount, getHealthFactorColor } from '@/lib/utils';

export function PositionPreview({ quote, market, debt, amount, indexedApy, estimatedRisk, loading }: { quote?: MarketQuote; market?: Market; debt?: Asset; amount: string; indexedApy?: string | null; estimatedRisk?: RiskMetrics; loading: boolean }) {
  const simulated = quote?.rateSource === 'simulation';
  const risk = simulated ? quote.risk : estimatedRisk;
  const borrowApy = quote?.rateSource === 'simulation' ? quote.borrowApy : indexedApy;
  const baseRate = market?.version === 4 && quote?.rateSource !== 'simulation';
  const stats = [
    { label: baseRate ? 'Base borrow APY' : 'Borrow APY', value: borrowApy != null ? `${(Number(borrowApy) * 100).toFixed(2)}%` : '0.00', title: quote?.rateSource === 'simulation' ? 'Amount-specific annualized cost from the native simulation, assuming the rate stays constant.' : baseRate ? 'Hub base rate from the Aave API. Your collateral risk premium is excluded until execution review.' : 'Market borrow rate from the Aave API. Final terms are checked before execution.' },
    { label: 'Health Factor', value: risk?.healthFactor ? formatAmount(risk.healthFactor, 2) : '0.00', title: simulated ? 'Native health factor after the proposed actions. Liquidation can occur below 1.' : 'Estimate from entered amounts, indexed oracle prices and collateral parameters. Standard V3 mode; excludes accrued debt and execution rounding.', isHealth: true },
    { label: 'Loan-to-Value', value: risk?.ltv ? `${(Number(risk.ltv) * 100).toFixed(2)}%` : '0.00', title: simulated ? 'Debt value divided by enabled collateral value inside this account.' : 'Entered debt USD value divided by enabled collateral USD value, using the selected market’s indexed oracle prices.' },
    { label: baseRate ? 'Base annual interest' : 'Annual interest', value: borrowApy != null ? `${formatAmount(Number(amount) * Number(borrowApy), 2)} ${debt?.symbol ?? ''}` : '0.00', title: baseRate ? 'Estimate at the base APY, excluding your collateral risk premium. Final cost is checked during review.' : 'Estimated annual compounded interest at the displayed APY. Rates can change; gas and collateral yield are excluded.' },
  ];
  return <Card className="position-preview">
    <CardHeader><div className="panel-heading"><CardTitle>Position preview</CardTitle>{market ? <span>{market.version === 3 ? 'V3 Pool' : 'V4 Spoke'}</span> : null}</div></CardHeader>
    <CardContent><TooltipProvider delay={150}><dl className="position-stats" aria-busy={loading}>{stats.map(stat => <div key={stat.label}><dt>{stat.label}<InfoTip label={stat.label} text={stat.title} /></dt><dd className={stat.isHealth ? cn('health-factor-value', getHealthFactorColor(loading ? null : risk?.healthFactor)) : undefined}>{stat.isHealth && risk?.healthFactor ? <Heart fill="currentColor" strokeWidth={2} aria-hidden="true" /> : null}<AnimatedNumber text={stat.value} /></dd></div>)}</dl></TooltipProvider>
    </CardContent>
  </Card>;
}

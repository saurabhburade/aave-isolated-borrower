'use client';

import { Boxes, Heart, Percent, RefreshCw } from 'lucide-react';
import type { Position } from '@/lib/domain';
import { portfolioSummary } from '@/lib/portfolio-summary';
import { cn, formatUsd, getHealthFactorColor } from '@/lib/utils';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { InfoTip } from './ui/info-tip';
import { Skeleton } from './ui/skeleton';
import { TooltipProvider } from './ui/tooltip';

export function PortfolioOverview({ positions, accountCount, available, loading, canRefresh, onRefresh }: {
  positions: Position[]; accountCount: number; available: boolean; loading: boolean; canRefresh: boolean; onRefresh: () => void;
}) {
  const pending = loading && !available;
  const totals = portfolioSummary(positions, available);
  const ratio = totals.debtUsd !== null && totals.collateralUsd !== null && totals.collateralUsd > 0 ? totals.debtUsd / totals.collateralUsd : null;
  const noDebt = totals.debtUsd === 0;
  const ltv = ratio === null ? '0.00' : `${(ratio * 100).toFixed(1)}%`;
  const healthDisplay = totals.health?.toLocaleString('en-US', { notation: 'compact', minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const healthLabel = totals.health?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });


  return <TooltipProvider delay={150}><div className="portfolio-overview" aria-label="Portfolio overview" aria-busy={loading}>
    <div className="portfolio-overview-heading">
      <h2>Portfolio overview</h2>
      <Button variant="ghost" size="sm" className="portfolio-refresh" aria-label="Refresh portfolio" onClick={onRefresh} disabled={loading || !canRefresh}><RefreshCw data-icon="inline-start" className={loading ? 'spin' : ''} />Refresh</Button>
    </div>
    <Card className="portfolio-metric portfolio-exposure" role="region" aria-label="Debt and collateral">
      <CardContent>
        <dl className="portfolio-exposure-values">
          <div><dt>Total collateral</dt><dd>{pending ? <Skeleton className="portfolio-metric-skeleton" /> : totals.collateralUsd === null ? '0.00' : formatUsd(totals.collateralUsd)}</dd></div>
          <div><dt>Total debt</dt><dd>{pending ? <Skeleton className="portfolio-metric-skeleton" /> : totals.debtUsd === null ? '0.00' : formatUsd(totals.debtUsd)}</dd></div>
        </dl>
        <div className="portfolio-doughnut" role="img" aria-label={ratio === null ? 'Loan-to-value unavailable' : `Debt is ${ltv} of collateral value`}>
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="portfolio-doughnut-track" cx="50" cy="50" r="42" strokeWidth="8" fill="none" />
            {ratio !== null ? <circle className="portfolio-doughnut-debt" cx="50" cy="50" r="42" strokeWidth="8" fill="none" pathLength="100" strokeDasharray={`${Math.min(Math.max(ratio, 0), 1) * 100} 100`} transform="rotate(-90 50 50)" /> : null}
          </svg>
          <div>{pending ? <Skeleton className="h-5 w-12" /> : <strong>{ltv}</strong>}<span>LTV</span></div>
        </div>
      </CardContent>
    </Card>
    <Card className="portfolio-metric portfolio-health-metric" role="region" aria-label="Cumulative health">
      <CardHeader><CardTitle><h3>Avg. health factor</h3><InfoTip label="cumulative health" text="Debt-weighted average of health factors. Each Aave account is liquidated independently; this average does not protect an account with a low health factor." /></CardTitle></CardHeader>
      <CardContent>{pending ? <Skeleton className="portfolio-metric-skeleton" /> : <strong className={cn('portfolio-metric-value portfolio-health', getHealthFactorColor(totals.health))} title={healthLabel} aria-label={healthLabel}>{healthDisplay ?? (noDebt ? 'No debt' : '0.00')}</strong>}</CardContent>
      <Heart className={cn('portfolio-corner-icon portfolio-corner-heart portfolio-health', getHealthFactorColor(pending ? null : totals.health))} aria-hidden="true" />
    </Card>
    <Card className="portfolio-metric portfolio-apy-metric" role="region" aria-label="Portfolio borrow APY">
      <CardHeader><CardTitle><h3>Borrow APY</h3><InfoTip label="portfolio borrow APY" text="Debt-weighted average of borrow APYs across open accounts. Unavailable when reserve-level USD weights or rates are missing." /></CardTitle></CardHeader>
      <CardContent>{pending ? <Skeleton className="portfolio-metric-skeleton" /> : <strong className="portfolio-metric-value">{totals.apy === null ? '0.00' : <>{(totals.apy * 100).toFixed(2)}<small>%</small></>}</strong>}</CardContent>
      <Percent className="portfolio-corner-icon" aria-hidden="true" />
    </Card>
    <Card className="portfolio-metric portfolio-accounts-metric" role="region" aria-label="Subaccount count">
      <CardHeader><CardTitle><h3>Subaccounts</h3><InfoTip label="subaccounts" text="Separate lending accounts owned by your wallet. Each account has its own collateral, debt and liquidation risk." /></CardTitle></CardHeader>
      <CardContent>{pending ? <Skeleton className="portfolio-metric-skeleton" /> : <strong className="portfolio-metric-value">{available ? accountCount : '0.00'}</strong>}</CardContent>
      <Boxes className="portfolio-corner-icon" aria-hidden="true" />
    </Card>
  </div></TooltipProvider>;
}

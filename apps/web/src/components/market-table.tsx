'use client';
import { Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { Asset, MarketQuote } from '@/lib/domain';
import { comparisonBorrowApy, estimateMarketRisk, type EstimateCollateral, type ComparisonMarket, type IndexedMarketRate } from '@/lib/market-catalog';
import { cn, formatAmount, getHealthFactorColor } from '@/lib/utils';
import { getNetwork } from '@/lib/networks';
import { ProtocolMark } from './protocol-mark';
import { NetworkIcon } from './network-selector';
const percent = (value: string | null | undefined) => value == null || !Number.isFinite(Number(value)) ? '0.00' : `${(Number(value) * 100).toFixed(2)}%`;

function RateSkeleton() {
  return <div className="ml-auto w-fit" role="status" aria-label="Loading borrow APY"><Skeleton className="h-4 w-14 rounded-md" /></div>;
}

export function MarketTable({ markets, quotes, selectedMarketId, onSelect, debt, rates, ratesLoading, catalogLoading = false, collaterals, debtAmount }: { markets: ComparisonMarket[]; quotes: MarketQuote[]; selectedMarketId: string | null; onSelect: (id: string) => void; debt?: Asset; rates: IndexedMarketRate[]; ratesLoading: boolean; catalogLoading?: boolean; collaterals: EstimateCollateral[]; debtAmount: string }) {
  return <div className="market-comparison-scroll"><Table className="platform-table">
    <caption className="sr-only">Aave markets supporting the selected debt and collateral, sorted by borrow APY. Lowest available APY selected by default.</caption>
    <TableHeader><TableRow><TableHead>Market</TableHead><TableHead className="text-right">Borrow APY</TableHead><TableHead className="text-right">Max LTV</TableHead><TableHead className="text-right">HF</TableHead></TableRow></TableHeader>
    <TableBody aria-busy={catalogLoading || ratesLoading}>{catalogLoading && !markets.length ? [0, 1, 2, 3].map(index => <TableRow key={index}>
      <TableCell><div className="platform-select flex min-h-11 items-center gap-2.5" role="status" aria-label="Loading market"><Skeleton className="size-9 shrink-0 rounded-full" /><div className="flex flex-col gap-2"><Skeleton className="h-4 w-20 rounded-md" /><Skeleton className="h-3 w-32 rounded-md" /></div></div></TableCell>
      <TableCell className="platform-apr"><RateSkeleton /></TableCell>
      <TableCell className="platform-risk"><Skeleton className="ml-auto h-4 w-12 rounded-md" /></TableCell>
      <TableCell className="platform-risk"><Skeleton className="ml-auto h-4 w-10 rounded-md" /></TableCell>
    </TableRow>) : !markets.length ? <TableRow><TableCell colSpan={4}>No markets support this asset and collateral combination.</TableCell></TableRow> : markets.map(market => {
      const quote = quotes.find(item => item.marketId === market.executionMarketId);
      const estimate = estimateMarketRisk(market, collaterals, debt, debtAmount, rates);
      const healthFactor = quote?.rateSource === 'simulation' ? quote.risk.healthFactor : estimate.healthFactor;
      const active = market.id === selectedMarketId;
      const borrowApy = comparisonBorrowApy(market, debt, rates);
      const network = getNetwork(market.chainId);
      const label = <><span className="market-protocol-icon"><ProtocolMark venue={market.name} />{network ? <span className="market-chain-badge" role="img" aria-label={`${market.network} network`} title={market.network}><NetworkIcon network={network} /></span> : null}</span><span className="platform-name"><span className="platform-name-line"><strong>Aave V{market.version}</strong>{active ? <Check className="market-selected-icon" aria-hidden="true" /> : null}</span><small>{market.name.replace(/^Aave V[34]\s*/, '')}{market.catalog?.isTestnet ? ' · Testnet' : ''}</small>{!market.executionMarketId ? <small>Comparison only</small> : null}</span></>;
      return <TableRow key={market.id} data-selectable="true" data-selected={active || undefined} onClick={() => onSelect(market.id)}>
        <TableCell><Button variant="ghost" className="platform-select" onClick={() => onSelect(market.id)} aria-label={market.name} aria-pressed={active}>{label}</Button></TableCell>
        <TableCell className="platform-apr">{borrowApy === null && ratesLoading ? <RateSkeleton /> : <strong title={borrowApy !== null ? `Aave V${market.version} GraphQL API rate.${market.version === 4 ? ' Base APY excludes the position collateral risk premium.' : ''}` : undefined}>{percent(borrowApy)}</strong>}</TableCell>
        <TableCell className="platform-risk"><span title="Maximum borrowing ratio for the enabled collateral, using indexed market parameters. Multiple collaterals are weighted by entered USD value.">{percent(estimate.maxLtv)}</span></TableCell>
        <TableCell className="platform-risk"><span className={cn('hf-value', getHealthFactorColor(healthFactor))} title={quote?.rateSource === 'simulation' ? 'Health factor from native simulation.' : 'Estimated health factor from entered amounts, indexed oracle prices and market collateral parameters. Enter collateral and debt amounts to calculate.'}>{healthFactor !== null ? formatAmount(healthFactor, 2) : '0.00'}</span></TableCell>
      </TableRow>;
    })}</TableBody>
  </Table></div>;
}

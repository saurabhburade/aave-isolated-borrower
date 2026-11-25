'use client';

import Link from 'next/link';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { ArrowUpRight } from 'lucide-react';
import type { Freshness, Position } from '@/lib/domain';
import { hasPositionBalance } from '@/lib/portfolio-summary';
import { PortfolioOverview } from './portfolio-overview';
import { PositionsTable, PositionsTableSkeleton } from './positions-table';
import { Button } from './ui/button';
import { Separator } from './ui/separator';

export function PositionsPortfolio({ chainId, owner, positions, freshness, loading, onRefresh, onManage }: {
  chainId: number; owner?: string; positions: Position[]; freshness: Freshness; loading: boolean; onRefresh: () => void; onManage: (position: Position) => void;
}) {
  const { openConnectModal } = useConnectModal();
  const available = Boolean(owner && freshness.status === 'fresh');
  const initialLoading = loading && !positions.length && freshness.status === 'unavailable';
  const open = positions.filter(hasPositionBalance);
  const accounts = [...new Map(positions.map((position) => [position.account.toLowerCase(), position])).values()];
  const error = owner && !loading && !available ? freshness.reason ?? 'Native positions are unavailable. Refresh to try again.' : null;

  const empty = <div className={`portfolio-empty${!owner ? ' portfolio-connect-empty' : ''}`}>
    {!owner ? <><span>Connect your wallet to see your lending positions.</span><div className="portfolio-connect-action"><Separator aria-hidden="true" /><Button size="sm" onClick={openConnectModal}>Connect wallet</Button><Separator aria-hidden="true" /></div></> : error ? <span>Positions unavailable.</span> : <><span>No open positions yet.</span><Link href={`/${chainId}`}>Explore borrow markets <ArrowUpRight size={15} aria-hidden="true" /></Link></>}
  </div>;

  return <section className="portfolio-dashboard" aria-labelledby="positions-title">
    <h1 id="positions-title" className="sr-only">Positions</h1>
    <p className="sr-only" role="status">{loading ? initialLoading ? 'Loading portfolio and positions…' : 'Refreshing portfolio…' : ''}</p>
    <PortfolioOverview positions={open} accountCount={accounts.length} available={available} loading={loading} canRefresh={Boolean(owner)} onRefresh={onRefresh} />
    <div className="portfolio-positions-card">
      <div className="portfolio-section-head">
        <h2 id="portfolio-positions-title">My Positions</h2>
        <Button variant="secondary" size="sm" nativeButton={false} role="link" render={<Link href={`/${chainId}`} />}>Borrow more</Button>
      </div>
      {error ? <p role="alert" className="portfolio-error">{error}</p> : null}
      <div className="portfolio-positions-panel" aria-busy={loading}>
        {initialLoading ? <PositionsTableSkeleton /> : open.length ? <PositionsTable positions={open} onManage={onManage} /> : empty}
      </div>
    </div>
  </section>;
}

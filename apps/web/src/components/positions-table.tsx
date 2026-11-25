'use client';

import { useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import type { Position } from '@/lib/domain';
import { positionBorrowApy } from '@/lib/portfolio-summary';
import { cn, formatAmount, formatUsd, getHealthFactorColor, shortAddress } from '@/lib/utils';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { MotionIcon } from './ui/motion-icon';
import { Skeleton } from './ui/skeleton';
import { ProtocolMark } from './protocol-mark';
import { SubaccountDetails } from './subaccount-details';

type SortKey = 'debt' | 'collateral' | 'apy' | 'health';
const headers: { key: SortKey; label: string }[] = [{ key: 'debt', label: 'Debt' }, { key: 'collateral', label: 'Collateral' }, { key: 'apy', label: 'Borrow APY' }, { key: 'health', label: 'Health factor' }];
const pageSize = 10;

function sortValue(position: Position, key: SortKey): number | null {
  if (position.freshness.status !== 'fresh') return null;
  if (key === 'apy') return positionBorrowApy(position);
  const raw = key === 'health' ? position.risk.healthFactor : key === 'debt' ? position.risk.debtUsd : position.risk.collateralUsd;
  return raw !== null && Number.isFinite(Number(raw)) ? Number(raw) : null;
}

function PositionAmount({ position, debt }: { position: Position; debt?: boolean }) {
  const balances = debt ? position.debts : position.collaterals;
  const usd = debt ? position.risk.debtUsd : position.risk.collateralUsd;
  return <div className="portfolio-position-amount">{position.freshness.status !== 'fresh' ? <strong>Unknown</strong> : balances.length ? balances.map((balance) => <strong key={balance.asset.id} title={balance.amount + ' ' + balance.asset.symbol}>{formatAmount(balance.amount)} <small>{balance.asset.symbol}</small></strong>) : <strong>None</strong>}<span>{position.freshness.status === 'fresh' ? formatUsd(usd) : 'USD unavailable'}</span></div>;
}

export function PositionsTableSkeleton() {
  return <div aria-label="Loading positions" role="status"><Table className="portfolio-positions-table portfolio-positions-skeleton" aria-hidden="true">
    <TableHeader><TableRow>{['Market', ...headers.map(({ label }) => label), ''].map((label, i) => <TableHead key={i}>{label}</TableHead>)}</TableRow></TableHeader>
    <TableBody>{[0, 1, 2].map((row) => <TableRow key={row}><TableCell><Skeleton className="size-[34px] rounded-full" /></TableCell>{headers.map(({ key }) => <TableCell key={key}><Skeleton className="ml-auto h-4 w-20" /></TableCell>)}<TableCell><Skeleton className="ml-auto h-8 w-20" /></TableCell></TableRow>)}</TableBody>
  </Table></div>;
}

export function PositionsTable({ positions, onManage }: { positions: Position[]; onManage: (position: Position) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; descending: boolean } | null>(null);
  const [page, setPage] = useState(0);
  const sorted = sort ? [...positions].sort((a, b) => {
    const left = sortValue(a, sort.key), right = sortValue(b, sort.key);
    if (left === null) return right === null ? 0 : 1;
    if (right === null) return -1;
    return (left - right) * (sort.descending ? -1 : 1);
  }) : positions;
  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const currentPage = Math.min(page, pageCount - 1);

  return <><Table id="portfolio-positions-table" className="portfolio-positions-table" aria-labelledby="portfolio-positions-title">
    <TableHeader><TableRow><TableHead scope="col">Market</TableHead>{headers.map(({ key, label }) => {
      const direction = sort?.key === key ? sort.descending ? 'desc' : 'asc' : 'none';
      return <TableHead key={key} scope="col" aria-sort={direction === 'none' ? 'none' : direction === 'asc' ? 'ascending' : 'descending'}><Button variant="ghost" size="sm" onClick={() => { setSort(direction === 'desc' ? null : { key, descending: direction === 'asc' }); setPage(0); }}>{label}<span className="portfolio-sort-icon" data-direction={direction}><MotionIcon icon={direction === 'asc' ? ArrowUp : direction === 'desc' ? ArrowDown : ArrowUpDown} state={direction} /></span></Button></TableHead>;
    })}<TableHead scope="col"><span className="sr-only">Actions</span></TableHead></TableRow></TableHeader>
    <TableBody>{sorted.slice(currentPage * pageSize, (currentPage + 1) * pageSize).map((position) => {
      const apy = positionBorrowApy(position);
      const fresh = position.freshness.status === 'fresh';
      return <TableRow key={position.id}><TableCell><div className="portfolio-position-venue"><ProtocolMark venue={position.market.name} /><span className="portfolio-account-main"><strong>{position.market.name.replace(/^Aave\s+/, '')}</strong><SubaccountDetails position={position} /></span></div></TableCell><TableCell><PositionAmount position={position} debt /></TableCell><TableCell><PositionAmount position={position} /></TableCell><TableCell><strong>{apy === null ? 'Unavailable' : (apy * 100).toFixed(2) + '%'}</strong></TableCell><TableCell><strong className={cn('portfolio-health', getHealthFactorColor(fresh ? position.risk.healthFactor : null))}>{!fresh ? 'Unknown' : position.risk.healthFactor === null ? position.debts.length === 0 ? 'No debt' : 'Unknown' : formatAmount(position.risk.healthFactor, 3)}</strong></TableCell><TableCell><Button variant="outline" size="sm" aria-haspopup="dialog" aria-label={'Manage ' + position.market.name + ' account ' + shortAddress(position.account)} onClick={() => onManage(position)}>Manage</Button></TableCell></TableRow>;
    })}</TableBody>
  </Table><div className="portfolio-pagination"><span role="status">{currentPage * pageSize + 1}–{Math.min((currentPage + 1) * pageSize, positions.length)} of {positions.length} positions</span><nav aria-label="Positions pagination"><Button variant="ghost" size="icon-lg" aria-label="Previous page of positions" aria-controls="portfolio-positions-table" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft /></Button><span>Page {currentPage + 1} of {pageCount}</span><Button variant="ghost" size="icon-lg" aria-label="Next page of positions" aria-controls="portfolio-positions-table" disabled={currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}><ChevronRight /></Button></nav></div></>;
}

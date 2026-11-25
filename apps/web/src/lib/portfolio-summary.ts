import type { Position } from './domain.ts';

function value(input: string | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null;
  const number = Number(input);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function hasPositionBalance(position: Position): boolean {
  return position.status === 'unknown'
    || [...position.collaterals, ...position.debts].some(balance => Number(balance.amount) > 0);
}

/** Different tokens cannot be weighted by their raw amounts without USD prices. */
export function positionBorrowApy(position: Position): number | null {
  if (position.freshness.status !== 'fresh') return null;
  const debts = position.debts.filter((debt) => Number(debt.amount) > 0);
  if (!debts.length) return null;
  const rate = value(debts[0].apy);
  if (rate === null || debts.some((debt) => value(debt.apy) !== rate)) return null;
  return rate;
}

export function portfolioSummary(positions: Position[], available: boolean) {
  if (!available || positions.some((position) => position.freshness.status !== 'fresh')) {
    return { debtUsd: null, collateralUsd: null, health: null, apy: null };
  }
  const sum = (field: 'debtUsd' | 'collateralUsd') => {
    let total = 0;
    for (const position of positions) {
      const amount = value(position.risk[field]);
      if (amount === null) return null;
      total += amount;
    }
    return total;
  };
  const debtUsd = sum('debtUsd');
  const weighted = (metric: (position: Position) => number | null) => {
    if (debtUsd === null || debtUsd === 0) return null;
    let total = 0;
    for (const position of positions) {
      const debt = value(position.risk.debtUsd);
      if (debt === null) return null;
      if (debt === 0) continue;
      const amount = metric(position);
      if (amount === null) return null;
      total += amount * debt;
    }
    return total / debtUsd;
  };
  return {
    debtUsd,
    collateralUsd: sum('collateralUsd'),
    health: weighted((position) => value(position.risk.healthFactor)),
    apy: weighted(positionBorrowApy),
  };
}

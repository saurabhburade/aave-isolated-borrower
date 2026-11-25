import { formatUnits, parseUnits } from 'viem';
import type { Balance, Freshness } from './domain.ts';
import { repayFunding } from './transaction-batch.ts';

export function fullRepaymentFunding(debt: Balance, freshness: Freshness, now = Date.now()): bigint {
  const units = parseUnits(debt.amount, debt.asset.decimals);
  const apy = Number(debt.apy ?? 0);
  const rateRay = Number.isFinite(apy) && apy > 0 ? BigInt(Math.ceil(Math.log1p(apy) * 1e27)) : 0n;
  const observedAt = freshness.observedAt ? Date.parse(freshness.observedAt) : now;
  const age = Number.isFinite(observedAt) ? Math.max(0, Math.ceil((now - observedAt) / 1000)) : 0;
  return repayFunding(units, rateRay.toString(), BigInt(age + 600));
}

export function maximumRepayment(debt: Balance, freshness: Freshness, walletBalance: bigint | undefined, now = Date.now()) {
  if (walletBalance === undefined) return null;
  const units = parseUnits(debt.amount, debt.asset.decimals);
  const required = fullRepaymentFunding(debt, freshness, now);
  const amount = formatUnits(walletBalance < units ? walletBalance : units, debt.asset.decimals);
  const fullRepayment = walletBalance >= required;
  return {
    amount, fullRepayment,
    warning: fullRepayment ? null : `Not enough ${debt.asset.symbol} to repay in full, including the interest buffer. Max will repay ${amount} ${debt.asset.symbol}; some debt may remain and your collateral will stay supplied.`,
  };
}

import type { Asset, Position } from './domain.ts';

export const MIN_WITHDRAWAL_HEALTH_FACTOR = 1_060_000_000_000_000_000n;

export function managementWarning({ kind, position, asset, fullRepayment, useMax }: {
  kind: 'repay' | 'supply' | 'withdraw';
  position: Position;
  asset?: Asset;
  fullRepayment: boolean;
  useMax: boolean;
}): string | null {
  if (kind === 'withdraw') {
    return `${useMax && asset ? `You're removing all supplied ${asset.symbol}. ` : ''}Keep your health factor at or above 1.06 when removing collateral.`;
  }
  if (!asset) return null;
  if (kind === 'repay' && fullRepayment) {
    return position.debts.length === 1
      ? "You're repaying the full debt and withdrawing all collateral in one transaction."
      : `You're repaying the full ${asset.symbol} debt. Other debts in this position remain open.`;
  }
  if (kind === 'supply') {
    const collateralTokens = new Set(position.collaterals
      .filter(balance => balance.collateralEnabled && Number(balance.amount) > 0)
      .map(balance => balance.asset.address.toLowerCase()));
    if (collateralTokens.size === 1 && !collateralTokens.has(asset.address.toLowerCase())) {
      return `Adding ${asset.symbol} makes this a cross-margin position. Both collateral tokens will back this position's debt.`;
    }
    if (useMax) return `You're adding your full ${asset.symbol} wallet balance as collateral.`;
  }
  return null;
}

import { encodeFunctionData, type Address, type Hex } from 'viem';
import type { Asset, ManagementAction, Market } from './domain.ts';
import { accountAbi, factoryAbi } from './abis.ts';
import { decimalAmount, MAX_UINT256 } from './validation.ts';
import { MIN_WITHDRAWAL_HEALTH_FACTOR } from './management-policy.ts';

export const ACTION = { supply: 0, withdraw: 1, borrow: 2, repay: 3, setCollateral: 4, refresh: 5 } as const;
export const DEFAULT_MIN_HEALTH_FACTOR = 1_050_000_000_000_000_000n;
export interface NativeAction { kind: number; token: Address; reserveId: bigint; amount: bigint; enabled: boolean }
export interface NativeLimits { deadline: bigint; minHealthFactor: bigint; maxBorrowRateRay: bigint }

export function encodeExecute(batch: { funding: Array<{ token: Address; amount: bigint }>; actions: NativeAction[]; limits: NativeLimits }): Hex {
  const funding = batch.funding.map((item) => [item.token, item.amount] as const);
  const actions = batch.actions.map((item) => [item.kind, item.token, item.reserveId, item.amount, item.enabled] as const);
  const limits = [batch.limits.deadline, batch.limits.minHealthFactor, batch.limits.maxBorrowRateRay] as const;
  return encodeFunctionData({ abi: accountAbi, functionName: 'execute', args: [funding, actions, limits] });
}

export interface ResolvedManagementAction { action: ManagementAction; asset: Asset; borrowRateRay?: string | null }

export function buildResolvedManagementBatch(items: ResolvedManagementAction[], deadline = BigInt(Math.floor(Date.now() / 1000) + 300)): { funding: Array<{ token: Address; amount: bigint }>; actions: NativeAction[]; limits: NativeLimits } {
  const funding: Array<{ token: Address; amount: bigint }> = [];
  const native: NativeAction[] = [];
  for (const { action, asset, borrowRateRay } of items) {
    const kind = action.kind === 'supply' ? ACTION.supply : action.kind === 'withdraw' ? ACTION.withdraw : action.kind === 'borrow' ? ACTION.borrow : action.kind === 'repay' || action.kind === 'repay-all' ? ACTION.repay : action.kind === 'set-collateral' ? ACTION.setCollateral : ACTION.refresh;
    const amount = action.kind === 'repay-all' || action.kind === 'close' ? MAX_UINT256 : action.kind === 'withdraw' && action.amount === MAX_UINT256.toString() ? MAX_UINT256 : action.kind === 'set-collateral' ? 0n : decimalAmount(action.amount, asset.decimals, 'management amount');
    const fundingAmount = action.kind === 'repay-all' && action.amount ? decimalAmount(action.amount, asset.decimals, 'repay funding') : amount;
    if (kind === ACTION.supply || kind === ACTION.repay) funding.push({ token: asset.address, amount: fundingAmount });
    native.push({ kind, token: asset.address, reserveId: asset.reserveId ? BigInt(asset.reserveId) : 0n, amount, enabled: action.enabled ?? false });
    if (action.kind === 'borrow') {
      if (!borrowRateRay) throw new Error(`Native borrow rate is unavailable for ${asset.symbol}.`);
    }
  }
  const borrowRates = items.filter(item => item.action.kind === 'borrow').map(item => BigInt(item.borrowRateRay ?? 0));
  const rate = borrowRates.reduce((max, value) => value > max ? value : max, 0n);
  return { funding, actions: native, limits: { deadline, minHealthFactor: items.some(({ action }) => action.kind === 'withdraw') ? MIN_WITHDRAWAL_HEALTH_FACTOR : DEFAULT_MIN_HEALTH_FACTOR, maxBorrowRateRay: rate === 0n ? 0n : rate + rate / 20n } };
}

/** Bound expected accrual for the review window, with unused funds refunded by the account. */
export function repayFunding(debt: bigint, annualRateRay: string | null, windowSeconds = 600n): bigint {
  const rate = annualRateRay === null ? 0n : BigInt(annualRateRay);
  const denominator = 10n ** 27n * 365n * 24n * 60n * 60n;
  const windowInterest = (debt * rate * windowSeconds + denominator - 1n) / denominator;
  const minimumBuffer = debt / 10_000n + 2n;
  return debt + (windowInterest > minimumBuffer ? windowInterest : minimumBuffer);
}

export interface CreationInputs {
  version: 3 | 4;
  collaterals: { asset: Asset; amount: string; enabled: boolean }[];
  debt: { asset: Asset; amount: string };
  deadline: bigint;
  minHealthFactor: bigint;
  maxBorrowRateRay: bigint;
}

export function buildResolvedCreationBatch(input: CreationInputs) {
  const funding = input.collaterals.map(row => ({ token: row.asset.address, amount: decimalAmount(row.amount, row.asset.decimals, 'collateral amount') }));
  const actions: NativeAction[] = [];
  for (const row of input.collaterals) {
    const reserveId = BigInt(row.asset.reserveId ?? '0');
    actions.push({ kind: ACTION.supply, token: row.asset.address, reserveId, amount: decimalAmount(row.amount, row.asset.decimals, 'collateral amount'), enabled: false });
    if (row.enabled) actions.push({ kind: ACTION.setCollateral, token: row.asset.address, reserveId, amount: 0n, enabled: true });
  }
  const reserveId = BigInt(input.debt.asset.reserveId ?? '0');
  if (input.version === 4) actions.push({ kind: ACTION.refresh, token: input.debt.asset.address, reserveId, amount: 0n, enabled: false });
  actions.push({ kind: ACTION.borrow, token: input.debt.asset.address, reserveId, amount: decimalAmount(input.debt.amount, input.debt.asset.decimals, 'debt amount'), enabled: false });
  return { funding, actions, limits: { deadline: input.deadline, minHealthFactor: input.minHealthFactor, maxBorrowRateRay: input.maxBorrowRateRay } };
}

export function encodeCreatePosition(_factory: Address, market: Pick<Market, 'version' | 'venue'>, salt: Hex, batch: ReturnType<typeof buildResolvedCreationBatch>): Hex {
  return encodeFunctionData({ abi: factoryAbi, functionName: 'createPosition', args: [market.version, market.venue, salt, batch.funding, batch.actions, batch.limits] });
}

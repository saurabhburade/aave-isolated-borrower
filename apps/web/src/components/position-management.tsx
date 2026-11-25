'use client';

import { useEffect, useLayoutEffect, useState, type FormEvent } from 'react';
import { useWalletBalance } from '@/hooks/use-wallet-balances';
import { formatUnits, maxUint256, parseUnits } from 'viem';
import { ChevronDown, MoveRight } from 'lucide-react';
import { AnimatePresence, motion, useReducedMotion, useSpring, useTransform } from 'motion/react';
import { useTransactionFlow } from '@/hooks/use-transaction-flow';
import { useMarketCatalog } from '@/hooks/use-protocol-data';
import type { Asset, ManagementAction, Position, RiskMetrics } from '@/lib/domain';
import type { CatalogMarket } from '@/lib/market-catalog';
import { buildPositionManagementPlan } from '@/lib/management-plan';
import { managementSupplyAssets } from '@/lib/management-assets';
import { maximumRepayment } from '@/lib/repayment';
import { managementWarning } from '@/lib/management-policy';
import { formatAmount, formatUsd, getHealthFactorColor, shortAddress } from '@/lib/utils';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AssetPicker } from './asset-picker';
import { TokenMark } from './token-mark';
import { ConfirmationDialog } from './confirmation-dialog';
import { AaveTransactionStatus } from './aave-transaction-status';
import { InlineNotice } from './inline-notice';
import { MotionActionTabs } from './motion-action-tabs';
import { MorphingText } from './morphing-text';

type ActionKind = 'repay' | 'supply' | 'withdraw';
const primaryActions = [
  { value: 'repay', label: 'Repay' },
  { value: 'supply', label: 'Add collateral' },
  { value: 'withdraw', label: 'Remove collateral' },
] as const;

function healthValue(risk: RiskMetrics | null | undefined) {
  if (risk?.healthFactor) return Number(risk.healthFactor).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return risk?.debtUsd != null && Number(risk.debtUsd) === 0 ? 'No debt' : 'Unknown';
}

const knownNumber = (value: string | null | undefined) => value != null && value.trim() !== '' && Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : null;

/** Informational deltas preserve the native account's weighted collateral baseline. */
function estimateManagementImpact(position: Position, asset: Asset, kind: ActionKind, amount: string, useMax: boolean, markets: CatalogMarket[]): RiskMetrics | null {
  if (position.freshness.status !== 'fresh') return null;
  const entered = knownNumber(amount);
  const collateralUsd = knownNumber(position.risk.collateralUsd);
  const debtUsd = knownNumber(position.risk.debtUsd);
  if (entered === null || entered <= 0 || collateralUsd === null || debtUsd === null) return null;
  const market = markets.find((candidate) => candidate.chainId === (position.chainId === 31337 ? 1 : position.chainId)
    && candidate.version === position.market.version && candidate.venue.toLowerCase() === position.market.venue.toLowerCase());
  const reserves = market?.reserves.filter((reserve) => reserve.address.toLowerCase() === asset.address.toLowerCase()
    && (asset.reserveId === undefined || reserve.reserveId === asset.reserveId)) ?? [];
  const reserve = reserves.length === 1 ? reserves[0] : undefined;
  const next: RiskMetrics = { ...position.risk, borrowCapacityUsd: null };
  const health = knownNumber(position.risk.healthFactor);
  const capacity = knownNumber(position.risk.borrowCapacityUsd);

  if (kind === 'repay') {
    const balance = position.debts.find((balance) => balance.asset.id === asset.id);
    const debtAmount = knownNumber(balance?.amount);
    if (debtAmount === null || debtAmount <= 0) return null;
    const debtUnits = parseUnits(balance!.amount, asset.decimals);
    const enteredUnits = parseUnits(amount, asset.decimals);
    const remainingUnits = enteredUnits >= debtUnits ? 0n : debtUnits - enteredUnits;
    const remainingFraction = Number(remainingUnits) / Number(debtUnits);
    const price = knownNumber(reserve?.usdPrice);
    const repaidUsd = position.debts.length === 1 ? debtUsd * (1 - remainingFraction) : price === null ? null : debtAmount * (1 - remainingFraction) * price;
    if (repaidUsd === null || position.debts.length > 1 && repaidUsd >= debtUsd) return null;
    const remaining = position.debts.length === 1 ? debtUsd * remainingFraction : Math.max(0, debtUsd - repaidUsd);
    next.debtUsd = remaining.toString();
    next.healthFactor = remaining === 0 ? null : health === null ? null : (health * debtUsd / remaining).toString();
    next.ltv = collateralUsd > 0 ? (remaining / collateralUsd).toString() : null;
    next.borrowCapacityUsd = capacity !== null && capacity > 0 ? (capacity + repaidUsd).toString() : null;
    return next;
  }

  const balance = position.collaterals.find((balance) => balance.asset.id === asset.id);
  if (kind === 'supply' && reserve?.canCollateral === false) return null;
  const supplied = knownNumber(balance?.amount) ?? 0;
  if (kind === 'withdraw' && (!balance || !useMax && entered > supplied)) return null;
  // Withdrawing a supply that is not enabled as collateral does not change native risk.
  if (kind === 'withdraw' && !balance?.collateralEnabled) return { ...position.risk };
  const enabled = position.collaterals.filter((balance) => balance.collateralEnabled);
  const soleCollateral = enabled.length === 1 && enabled[0].asset.id === asset.id && supplied > 0;
  const price = soleCollateral ? collateralUsd / supplied : knownNumber(reserve?.usdPrice);
  if (price === null || price <= 0) return null;
  const delta = kind === 'supply' ? entered + (balance && !balance.collateralEnabled ? supplied : 0) : -(useMax ? supplied : entered);
  const deltaUsd = delta * price;
  const threshold = knownNumber(reserve?.liquidationThreshold) ?? (soleCollateral && health !== null && collateralUsd > 0 ? health * debtUsd / collateralUsd : null);
  const maxLtv = knownNumber(reserve?.maxLtv);
  const total = Math.max(0, collateralUsd + deltaUsd);
  next.collateralUsd = total.toString();
  next.healthFactor = debtUsd === 0 ? null : health === null || threshold === null || threshold > 1 ? null : (Math.max(0, health * debtUsd + deltaUsd * threshold) / debtUsd).toString();
  next.ltv = total > 0 ? (debtUsd / total).toString() : null;
  next.borrowCapacityUsd = capacity !== null && (capacity > 0 || debtUsd === 0) && maxLtv !== null && maxLtv <= 1 ? Math.max(0, capacity + deltaUsd * maxLtv).toString() : null;
  next.riskPremiumBps = null;
  return next;
}

function RollingDigit({ digit }: { digit: number }) {
  const reducedMotion = useReducedMotion();
  const value = useSpring(digit, { stiffness: 240, damping: 30, mass: 0.7 });
  const y = useTransform(value, (current) => `${-current * 1.25}em`);
  useLayoutEffect(() => {
    if (reducedMotion) value.jump(digit);
    else value.set(digit);
  }, [digit, reducedMotion, value]);
  return <span className="manage-digit" data-digit={digit}>
    <motion.span className="manage-digit-strip" style={{ y }}>{Array.from({ length: 10 }, (_, number) => <span key={number}>{number}</span>)}</motion.span>
  </span>;
}

function MetricNumber({ text, pending = false }: { text: string; pending?: boolean }) {
  if (!/^\$?[\d,]+(?:\.\d+)?$/.test(text)) return <MorphingText text={text} shimmer={pending} />;
  return <span className="manage-number" data-value={text}>
    <span className="sr-only">{text}</span>
    <span className="manage-number-display" aria-hidden="true">{[...text].map((character, index) => /\d/.test(character)
      ? <RollingDigit key={`digit-${text.length - index}`} digit={Number(character)} />
      : <span key={`separator-${text.length - index}`}>{character}</span>)}</span>
  </span>;
}

function ManagementMetric({ label, current, next, currentTone, nextTone, pending }: {
  label: string; current: string; next: string | null; currentTone?: string; nextTone?: string; pending: boolean;
}) {
  const reducedMotion = useReducedMotion();
  return <div><dt>{label}</dt><dd>
    <span className={currentTone}><MetricNumber text={current} /></span>
    <AnimatePresence initial={false}>
      {next !== null ? <motion.span key="next" className="manage-impact-next"
        initial={reducedMotion ? false : { opacity: 0 }} animate={{ opacity: 1 }}
        exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : 0.15, ease: 'easeOut' }}>
        <MoveRight className="manage-impact-arrow" size={16} strokeWidth={1.5} aria-hidden="true" />
        <strong className={nextTone}><MetricNumber text={next} pending={pending} /></strong>
      </motion.span> : null}
    </AnimatePresence>
  </dd></div>;
}

export function PositionManagementDialog({ position, owner, open, onClose, onComplete }: { position: Position | null; owner: string | undefined; open: boolean; onClose: () => void; onComplete: () => void }) {
  const [kind, setKind] = useState<ActionKind>('repay');
  const [assetId, setAssetId] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [amount, setAmount] = useState('');
  const [useMax, setUseMax] = useState(false);
  const execution = useTransactionFlow();
  const catalog = useMarketCatalog(position?.chainId ?? 31337);
  const assets = kind === 'repay' ? position?.debts.map((balance) => balance.asset) ?? []
    : kind === 'withdraw' ? position?.collaterals.map((balance) => balance.asset) ?? []
    : managementSupplyAssets(position, catalog.markets);
  const fixedDebtAsset = kind === 'repay' && assets.length === 1 ? assets[0] : undefined;
  const asset = fixedDebtAsset ?? assets.find((candidate) => candidate.id === assetId);
  const walletBalance = useWalletBalance(asset, position?.chainId ?? 31337, Boolean(open && owner && (kind === 'supply' || kind === 'repay')), owner as `0x${string}` | undefined);
  const supplied = position?.collaterals.find((balance) => balance.asset.id === asset?.id)?.amount;
  const debtBalance = position?.debts.find((balance) => balance.asset.id === asset?.id);
  const debt = debtBalance?.amount;
  const repayMax = position && debtBalance ? maximumRepayment(debtBalance, position.freshness, walletBalance.value) : null;
  const walletAmount = walletBalance.value !== undefined && asset ? formatUnits(walletBalance.value, asset.decimals) : undefined;
  const available = kind === 'withdraw' ? supplied : kind === 'repay' ? debt : walletAmount;
  const maxAmount = kind === 'repay' ? repayMax?.amount : available;
  const balanceLabel = kind === 'withdraw' ? 'Supplied' : 'Debt';
  const balanceLoading = walletBalance.loading;
  const busy = ['approving', 'preparing', 'signing', 'confirming', 'syncing'].includes(execution.phase);
  const done = execution.phase === 'reverted' || execution.phase === 'success' || execution.phase === 'pending-native' || (execution.phase === 'error' && Boolean(execution.hash));
  const locked = busy || done;
  const normalizedAmount = amount.replace(/^\./, '0.').replace(/\.$/, '');
  const validAmount = Boolean(asset && /^\d+(?:\.\d+)?$/.test(normalizedAmount) && (normalizedAmount.split('.')[1]?.length ?? 0) <= asset.decimals && Number.isFinite(Number(normalizedAmount)) && Number(normalizedAmount) > 0);
  const canPreview = Boolean(position && owner && validAmount);
  const fullRepayment = Boolean(kind === 'repay' && asset && debt !== undefined && (useMax ? repayMax?.fullRepayment && normalizedAmount === repayMax.amount : validAmount && parseUnits(normalizedAmount, asset.decimals) >= parseUnits(debt, asset.decimals)));
  const closingPosition = fullRepayment && position?.debts.length === 1;
  const action: ManagementAction | null = asset ? {
    kind: closingPosition ? 'close' : fullRepayment ? 'repay-all' : kind, assetId: asset.id, enabled: true,
    amount: fullRepayment ? undefined : useMax && kind === 'withdraw' ? maxUint256.toString() : normalizedAmount,
  } : null;
  const riskBefore = position?.risk;
  const riskAfter = position && asset && canPreview ? estimateManagementImpact(position, asset, kind, normalizedAmount, useMax, catalog.markets) : null;
  const usingEstimate = Boolean(riskAfter);
  const showNext = open && canPreview;
  const impactKey = kind === 'repay' ? 'debtUsd' : 'collateralUsd';
  const impactLabel = impactKey === 'debtUsd' ? 'Debt' : 'Collateral';
  const warning = kind === 'repay' && useMax && repayMax?.warning ? repayMax.warning
    : position ? managementWarning({ kind, position, asset, fullRepayment, useMax }) : null;

  const invalidate = () => { execution.reset(); };
  useEffect(() => {
    setKind('repay'); setAssetId(''); setPickerOpen(false); setAmount(''); setUseMax(false);
    execution.reset();
  }, [open, owner, position?.id, execution.reset]);

  const changeKind = (value: ActionKind) => {
    invalidate(); setKind(value); setAssetId(''); setPickerOpen(false); setAmount(''); setUseMax(false);
  };
  const changeAsset = (value: string) => {
    invalidate(); setAssetId(value); setAmount(''); setUseMax(false);
  };
  const confirm = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!position || !action || !canPreview || locked || !['idle', 'error'].includes(execution.phase) || execution.hash) return;
    try {
      await execution.execute(async () => buildPositionManagementPlan(position, action));
    } catch {
      // The transaction flow displays preparation and wallet errors.
    }
  };

  return <ConfirmationDialog open={open} onClose={() => { if (execution.phase === 'success') onComplete(); invalidate(); onClose(); }} title="Manage position"
    description={position ? `${position.market.name} · ${shortAddress(position.account)}` : 'Review and confirm your position changes.'}
    busy={busy} done={done}
    actionDisabled={!canPreview}
    onConfirm={() => { void confirm(); }}
    status={<>{warning ? <InlineNotice>{warning}</InlineNotice> : null}<AaveTransactionStatus phase={execution.phase} error={execution.error} hash={execution.hash} approvalTransactions={execution.approvalTransactions} management /></>}>
    <form className="manage-form aave-review-body" onSubmit={confirm}>
      <MotionActionTabs value={kind} disabled={locked} onChange={changeKind} options={primaryActions} />
      <div className="position-manage-panel" role="tabpanel" id="position-manage-panel" aria-labelledby={`position-manage-tab-${kind}`}>
        <InputGroup variant="amount" className="manage-amount-card" aria-label="Position amount entry" data-asset={asset?.symbol}>
          <div className="amount-line">
            <InputGroupInput id="manage-amount" inputMode="decimal" autoComplete="off" value={amount} disabled={locked} onChange={(event) => { invalidate(); setUseMax(false); setAmount(event.target.value.replace(/[^0-9.]/g, '')); }} placeholder="0.00" aria-label="Management amount" />
            <InputGroupAddon align="inline-end">
              {fixedDebtAsset || kind === 'repay' && !assets.length ? <span className="manage-asset-badge" aria-label="Loan asset">
                {asset ? <><TokenMark token={asset.symbol} icon={asset.icon} /><span>{asset.symbol}</span></> : 'No debt'}
              </span> : <Button type="button" variant="asset" size="asset" className="manage-asset-trigger" disabled={locked || !assets.length} aria-label="Management asset" aria-haspopup="dialog" aria-expanded={pickerOpen} onClick={() => setPickerOpen(true)}>
                {asset ? <TokenMark token={asset.symbol} icon={asset.icon} /> : null}
                <span>{asset?.symbol ?? 'Select asset'}</span><ChevronDown aria-hidden="true" />
              </Button>}
            </InputGroupAddon>
          </div>
          <InputGroupAddon align="block-end">
            <div className="amount-meta manage-amount-meta">
              <span className="manage-position-balance" title={asset && kind !== 'supply' ? `${balanceLabel}: ${available ?? 'Unavailable'} ${asset.symbol}` : undefined}>{asset && kind !== 'supply' ? `${balanceLabel}: ${available === undefined ? '—' : formatAmount(available, 8)}` : null}</span>
              <span className="manage-wallet-balance">{kind !== 'withdraw' && asset ? balanceLoading ? <Skeleton className="h-3 w-20" role="status" aria-label="Loading wallet balance" /> : <span title={`Wallet balance: ${walletAmount ?? 'Unavailable'} ${asset.symbol}`}>Bal: {walletAmount === undefined ? '—' : formatAmount(walletAmount, 2)}</span> : null}
                <button type="button" className="manage-max" disabled={locked || !asset || !maxAmount || Number(maxAmount) <= 0} aria-pressed={useMax} title={kind === 'repay' ? 'Repay up to your available balance' : kind === 'withdraw' ? 'Remove all supplied collateral' : 'Use full wallet balance'} onClick={() => { invalidate(); setAmount(maxAmount ?? ''); setUseMax(true); }}>Max</button>
              </span>
            </div>
          </InputGroupAddon>
        </InputGroup>
        {!assets.length ? <p className="position-manage-hint">{kind === 'repay' ? 'No debt to repay.' : kind === 'withdraw' ? 'No supplied assets to withdraw.' : 'No assets available.'}</p> : null}
        <dl className="manage-impact" aria-label={showNext ? 'Position impact' : 'Current position'} aria-live="polite">
          <ManagementMetric label="Health Factor" current={healthValue(riskBefore)} currentTone={getHealthFactorColor(riskBefore?.healthFactor)}
            next={showNext ? riskAfter ? healthValue(riskAfter) : 'Unavailable' : null}
            nextTone={getHealthFactorColor(riskAfter?.healthFactor)} pending={false} />
          <ManagementMetric label={usingEstimate ? `Est. ${impactLabel.toLowerCase()}` : impactLabel} current={formatUsd(riskBefore?.[impactKey])}
            next={showNext ? riskAfter ? formatUsd(riskAfter[impactKey]) : 'Unavailable' : null} pending={false} />
          {closingPosition ? <ManagementMetric label="Collateral" current={formatUsd(riskBefore?.collateralUsd)}
            next={formatUsd('0')} pending={false} /> : null}
        </dl>
      </div>
    </form>
    <AssetPicker chainId={position?.chainId ?? 31337} open={open && pickerOpen} title={kind === 'repay' ? 'Select repayment asset' : 'Select collateral asset'} assets={assets} selectedId={asset?.id ?? ''}
      onSelect={(selected) => { if (selected.id !== asset?.id) changeAsset(selected.id); }} onClose={() => setPickerOpen(false)} />
  </ConfirmationDialog>;
}

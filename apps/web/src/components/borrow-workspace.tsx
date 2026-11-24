'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, RefreshCw, X } from 'lucide-react';
import { useAccount } from 'wagmi';
import { useWalletBalances } from '@/hooks/use-wallet-balances';
import { exceedsBalance } from '@/lib/wallet-balances';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import type { Asset, BorrowRequest, CollateralInput, ReviewPlan } from '@/lib/domain';
import { MotionButton as Button } from '@/components/ui/motion-button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FieldGroup } from '@/components/ui/field';
import { cn, formatUsd } from '@/lib/utils';
import { getNetwork } from '@/lib/networks';
import { catalogAssets as apiAssets, comparisonMarkets, comparisonBorrowApy, comparisonBorrowRateRay, bindBorrowRequest, estimateMarketRisk, catalogAmountUsd, filterComparisonMarkets, rankComparisonMarkets } from '@/lib/market-catalog';
import { buildSelectedMarketPlan } from '@/lib/creation-plan';
import { DEFAULT_MIN_HEALTH_FACTOR } from '@/lib/transaction-batch';
import { useCreationIntent } from '@/hooks/use-creation-intent';
import { useIndexedMarketRates, useMarketCatalog, useMarkets } from '@/hooks/use-protocol-data';
import { useTransactionFlow } from '@/hooks/use-transaction-flow';
import { AmountField } from './amount-field';
import { AmountPanelSkeleton } from './amount-panel';
import { AssetPicker } from './asset-picker';
import { MarketTable } from './market-table';
import { MarketOverview } from './market-overview';
import { RateHistoryPanel } from './rate-history-panel';
import { PositionPreview } from './position-preview';
import { ReviewDialog } from './review-dialog';
import { InlineNotice } from './inline-notice';

const defaultCollateral = (assets: Asset[]) => assets.find((asset) => asset.symbol === 'WETH') ?? assets[0];
const defaultDebt = (assets: Asset[]) => assets.find((asset) => asset.symbol === 'USDC') ?? assets.find((asset) => asset.symbol !== defaultCollateral(assets)?.symbol);
const minimumHealthFactor = Number(DEFAULT_MIN_HEALTH_FACTOR) / 1e18;

export function BorrowWorkspace({ chainId }: { chainId: number }) {
  const { address } = useAccount();
  const reducedMotion = useReducedMotion();
  const { openConnectModal } = useConnectModal();
  const { markets, creationDeployment, freshness, loading: marketsLoading, refresh: refreshMarkets } = useMarkets(chainId);
  const catalog = useMarketCatalog(chainId);
  const comparisonRows = useMemo(() => comparisonMarkets(markets, catalog.markets, chainId), [markets, catalog.markets, chainId]);
  const assets = useMemo(() => apiAssets(catalog.markets, chainId), [catalog.markets, chainId]);
  const collateralAssets = useMemo(() => apiAssets(catalog.markets, chainId, 'collateral'), [catalog.markets, chainId]);
  const debtAssets = useMemo(() => apiAssets(catalog.markets, chainId, 'debt'), [catalog.markets, chainId]);
  const [collaterals, setCollaterals] = useState<CollateralInput[]>([]);
  const walletBalances = useWalletBalances(assets, chainId);
  const exceedsWalletBalance = collaterals.some(row => {
    const asset = assets.find(asset => asset.id === row.assetId);
    return Boolean(asset && exceedsBalance(row.amount, asset.decimals, walletBalances.get(asset.address.toLowerCase())?.value));
  });
  const [debtAssetId, setDebtAssetId] = useState('');
  const [debtAmount, setDebtAmount] = useState('');
  const [filter, setFilter] = useState<'all' | 3 | 4>('all');
  const [preferredMarket, setPreferredMarket] = useState<{ id: string; key: string } | null>(null);
  const [picker, setPicker] = useState<'debt' | number | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const { salt, reset: resetIntent } = useCreationIntent(chainId, address);
  const quoteRequest = collaterals.length && debtAssetId ? { chainId, collaterals, debt: { assetId: debtAssetId, amount: debtAmount } } as BorrowRequest : null;
  const [plan, setPlan] = useState<ReviewPlan | null>(null);
  const execution = useTransactionFlow();
  const collateralDefault = defaultCollateral(collateralAssets); const debtDefault = defaultDebt(debtAssets);
  const debtAsset = assets.find(asset => asset.id === debtAssetId);
  const filteredMarkets = useMemo(() => filterComparisonMarkets(comparisonRows, filter, debtAsset, collaterals.map(row => ({ asset: assets.find(asset => asset.id === row.assetId), enabled: row.enabled }))), [comparisonRows, filter, debtAsset, collaterals, assets]);
  const indexedRates = useIndexedMarketRates(chainId, filteredMarkets.flatMap(market => market.catalog ? [market.catalog.id] : []), debtAsset?.address);
  const shownMarkets = useMemo(() => rankComparisonMarkets(filteredMarkets, debtAsset, indexedRates.rates), [filteredMarkets, debtAsset, indexedRates.rates]);
  const selectionKey = JSON.stringify({ chainId, filter, debtAssetId, collaterals: collaterals.map(({ assetId, enabled }) => ({ assetId, enabled })) });
  const selectedMarketId = preferredMarket?.key === selectionKey && shownMarkets.some(market => market.id === preferredMarket.id)
    ? preferredMarket.id : shownMarkets.find(market => comparisonBorrowApy(market, debtAsset, indexedRates.rates) !== null)?.id ?? null;
  const selectedMarket = shownMarkets.find(market => market.id === selectedMarketId);
  const executionRequest = bindBorrowRequest(quoteRequest, selectedMarket, debtAsset, indexedRates.rates);
  const estimateCollaterals = collaterals.map(row => ({ ...row, asset: assets.find(asset => asset.id === row.assetId) }));
  const estimatedRisk = selectedMarket ? estimateMarketRisk(selectedMarket, estimateCollaterals, debtAsset, debtAmount, indexedRates.rates) : undefined;
  const selectedApy = selectedMarket ? comparisonBorrowApy(selectedMarket, debtAsset, indexedRates.rates) : null;
  const estimatedApr = selectedApy === null ? null : Math.log1p(Number(selectedApy)).toString();
  const amountUsd = (asset: Asset | undefined, amount: string) => {
    const ordered = selectedMarket?.catalog ? [selectedMarket.catalog, ...catalog.markets] : catalog.markets;
    const value = catalogAmountUsd(ordered, chainId, asset, amount);
    return value === null ? '0.00' : formatUsd(value);
  };
  const request = executionRequest; const validRequest = Boolean(request && request.collaterals.some((row) => Number(row.amount) > 0) && Number(request.debt.amount) > 0);
  const healthFactorValue = estimatedRisk?.healthFactor;
  const healthFactor = healthFactorValue == null || healthFactorValue.trim() === '' ? NaN : Number(healthFactorValue);
  const healthFactorTooLow = validRequest && !catalog.loading && !indexedRates.loading && Number.isFinite(healthFactor) && healthFactor < minimumHealthFactor;
  const requestKey = JSON.stringify({ request, selectedMarketId, address, chainId, healthFactorTooLow });

  useEffect(() => { if (!collaterals.length && collateralDefault) setCollaterals([{ assetId: collateralDefault.id, amount: '', enabled: true }]); if (!debtAssetId && debtDefault) setDebtAssetId(debtDefault.id); }, [collateralDefault, collaterals.length, debtAssetId, debtDefault]);
  useEffect(() => { setPlan(null); execution.reset(); setReviewOpen(false); }, [requestKey, execution.reset]);

  const updateCollateral = (index: number, patch: Partial<CollateralInput>) => {
    if (patch.assetId !== undefined) setPreferredMarket(null);
    setCollaterals(rows => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  };
  const openReview = () => {
    if (healthFactorTooLow) return;
    // A new review gets a fresh address; rejected signatures retry this same intent.
    if (salt) resetIntent(salt);
    setPlan(null);
    setReviewOpen(true);
  };
  const execute = () => {
    if (healthFactorTooLow) return;
    void execution.execute(async () => {
      if (!request || !selectedMarket?.executionMarketId || !address || !salt || !creationDeployment || estimatedApr === null) throw new Error('Market data is unavailable. Refresh markets before signing.');
      const nextPlan = buildSelectedMarketPlan({ deployment: creationDeployment, market: selectedMarket, request, owner: address, salt, borrowApr: estimatedApr, borrowRateRay: comparisonBorrowRateRay(selectedMarket, debtAsset, indexedRates.rates), freshness });
      setPlan(nextPlan);
      return nextPlan;
    }, confirmed => { resetIntent(confirmed.intentSalt); refreshMarkets(); }).catch(() => {});
  };
  const closeReview = () => {
    setReviewOpen(false);
    execution.reset();
    setPlan(null);
  };
  const pickerAssets = picker === 'debt'
    ? debtAssets.filter(asset => !collaterals.some(row => row.assetId === asset.id))
    : collateralAssets.filter(asset => asset.id !== debtAssetId && !collaterals.some((row, index) => index !== picker && row.assetId === asset.id));
  const nextCollateral = collateralAssets.find(asset => asset.id !== debtAssetId && !collaterals.some(row => row.assetId === asset.id));
  const refresh = () => { catalog.refresh(); indexedRates.refresh(); refreshMarkets(); };

  const network = getNetwork(chainId)!;
  return <>
    <h1 className="sr-only">Create an isolated position</h1>
    <div className="borrow-grid">
      <section className="borrow-column" aria-label="Borrow widget">
        <Card variant="borrow" className="w-full">
          <CardHeader className="borrow-heading"><div className="panel-heading"><CardTitle>Borrow</CardTitle><div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-lg" aria-label="Refresh borrow quote" title="Refresh markets" disabled={catalog.refreshing} onClick={refresh}><RefreshCw className={cn(catalog.refreshing && 'motion-safe:animate-spin')} /></Button>
          </div></div></CardHeader>
          <CardContent>
            <FieldGroup className="gap-2">
              {collaterals.map((row, index) => <div className="collateral-entry" key={`${index}-${row.assetId}`}><AmountField chainId={chainId} label={`Collateral amount ${index + 1}`} asset={assets.find(asset => asset.id === row.assetId)} value={row.amount} usd={amountUsd(assets.find(asset => asset.id === row.assetId), row.amount)} onChange={value => updateCollateral(index, { amount: value })} onAssetClick={() => setPicker(index)} />{collaterals.length > 1 ? <Button variant="ghost" size="icon-sm" className="collateral-remove" aria-label={`Remove collateral ${index + 1}`} onClick={() => setCollaterals(rows => rows.filter((_, rowIndex) => rowIndex !== index))}><X /></Button> : null}</div>)}
              {!collaterals.length && catalog.loading ? <AmountPanelSkeleton label="Collateral amount 1" /> : null}
              <Button variant="ghost" size="xs" className="add-collateral" aria-label="Add asset" disabled={!nextCollateral} onClick={() => { if (nextCollateral) setCollaterals(rows => [...rows, { assetId: nextCollateral.id, amount: '', enabled: true }]); }}><Plus />Add collateral</Button>
              <AmountField chainId={chainId} label="Debt amount" asset={debtAsset} loading={catalog.loading} value={debtAmount} usd={amountUsd(debtAsset, debtAmount)} onChange={setDebtAmount} onAssetClick={() => setPicker('debt')} />
            </FieldGroup>
            {address && !marketsLoading && freshness.status !== 'fresh' ? <InlineNotice>{freshness.reason ?? 'Native markets are unavailable.'}</InlineNotice> : null}
            <AnimatePresence initial={false}>
              {exceedsWalletBalance ? <motion.div key="wallet-balance-alert" id="borrow-wallet-balance-alert" className="overflow-hidden"
                initial={{ height: 0, opacity: 0, y: reducedMotion ? 0 : -4 }}
                animate={{ height: 'auto', opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0, y: reducedMotion ? 0 : -4 }}
                transition={{ duration: reducedMotion ? 0 : 0.15, ease: 'easeOut' }}>
                <InlineNotice>Amount exceeds your wallet balance.</InlineNotice>
              </motion.div> : null}
            </AnimatePresence>
            <AnimatePresence initial={false}>
              {healthFactorTooLow ? <motion.div key="health-factor-alert" id="borrow-health-factor-error" className="overflow-hidden"
                initial={{ height: 0, opacity: 0, y: reducedMotion ? 0 : -4 }}
                animate={{ height: 'auto', opacity: 1, y: 0 }}
                exit={{ height: 0, opacity: 0, y: reducedMotion ? 0 : -4 }}
                transition={{ duration: reducedMotion ? 0 : 0.15, ease: 'easeOut' }}>
                <InlineNotice tone="error">Health factor too low to proceed. Increase collateral or reduce the borrow amount to reach at least {minimumHealthFactor}.</InlineNotice>
              </motion.div> : null}
            </AnimatePresence>
            <Button size="base" className="borrow-primary mt-2 w-full" aria-label={address ? 'Review position' : 'Connect wallet'} aria-describedby={healthFactorTooLow ? 'borrow-health-factor-error' : undefined} onClick={() => address ? openReview() : openConnectModal?.()} disabled={healthFactorTooLow || Boolean(address && (exceedsWalletBalance || !validRequest || !selectedMarket?.executionMarketId || !salt))}>{address ? 'Review position' : 'Connect wallet'}</Button>
            {address && selectedMarket && !selectedMarket.executionMarketId ? <InlineNotice>{selectedMarket.reason}</InlineNotice> : null}
          </CardContent>
        </Card>
        <PositionPreview market={selectedMarket} debt={debtAsset} amount={debtAmount} indexedApy={selectedApy} estimatedRisk={estimatedRisk} loading={catalog.loading || indexedRates.loading} />
      </section>
      <aside className="quote-column" aria-label="Markets and rate history">
        <div className="market-history-card"><MarketOverview network={network} collateral={assets.find(asset => asset.id === collaterals[0]?.assetId)} debt={debtAsset} extraCollateral={Math.max(0, collaterals.length - 1)} /><RateHistoryPanel network={network} debt={debtAsset} markets={filteredMarkets} marketsLoading={catalog.loading} /></div>
        <Card variant="comparison">
          <CardHeader>
            <div className="panel-heading"><CardTitle>Market comparison <span className="text-muted-foreground">({shownMarkets.length})</span></CardTitle><div className="market-filter-controls">
              <Button variant="ghost" size="icon-lg" aria-label="Refresh markets" disabled={catalog.refreshing} onClick={refresh}><RefreshCw className={cn(catalog.refreshing && 'motion-safe:animate-spin')} /></Button>
              <div className="filter-tabs" role="group" aria-label="Market version filter">{(['all', 3, 4] as const).map(value => <button type="button" key={value} className={filter === value ? 'filter-active' : ''} aria-pressed={filter === value} onClick={() => { setFilter(value); setPreferredMarket(null); }}>{value === 'all' ? 'All' : `V${value}`}</button>)}</div>
            </div></div>
          </CardHeader>
          <CardContent className="comparison-content">
            {indexedRates.errors.map(error => <InlineNotice key={error}>{error}</InlineNotice>)}
            {catalog.errors.map(error => <InlineNotice key={error}>{error}</InlineNotice>)}
            <MarketTable markets={shownMarkets} quotes={[]} selectedMarketId={selectedMarketId} onSelect={id => setPreferredMarket({ id, key: selectionKey })} debt={debtAsset} rates={indexedRates.rates} ratesLoading={indexedRates.loading} collaterals={estimateCollaterals} debtAmount={debtAmount} catalogLoading={catalog.loading} />
          </CardContent>
        </Card>
      </aside>
    </div>
    <AssetPicker chainId={chainId} open={picker !== null} title={picker === 'debt' ? 'Select debt asset' : `Select collateral asset ${Number(picker) + 1}`} assets={pickerAssets} selectedId={picker === 'debt' ? debtAssetId : picker === null ? '' : collaterals[picker]?.assetId ?? ''} onSelect={asset => { if (picker === 'debt') { setDebtAssetId(asset.id); setPreferredMarket(null); } else if (typeof picker === 'number') updateCollateral(picker, { assetId: asset.id }); }} onClose={() => setPicker(null)} />
    <ReviewDialog open={reviewOpen} onClose={closeReview} request={request ?? { chainId, collaterals: [], debt: { assetId: '', amount: '' } }} market={selectedMarket} assets={assets} plan={plan} estimatedApr={estimatedApr} estimatedRisk={estimatedRisk} canExecute={validRequest && !exceedsWalletBalance && !healthFactorTooLow && Boolean(selectedMarket?.executionMarketId && address && salt && creationDeployment)} onExecute={execute} executePhase={execution.phase} executeError={execution.error} txHash={execution.hash} approvalTransactions={execution.approvalTransactions} />
  </>;
}

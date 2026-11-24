'use client';
import { Field, FieldLabel } from '@/components/ui/field';
import { InputGroup, InputGroupInput, InputGroupAddon } from '@/components/ui/input-group';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TokenMark } from './token-mark';

type Props = {
  token: string; icon?: string; id?: string; label: string; value: string; usd: string;
  balance: string; loading: boolean; invalid: boolean;
  onChange: (value: string) => void; onAssetClick: () => void;
};

export function AmountPanelSkeleton({ label }: { label: string }) {
  return <Field className="gap-0" role="status" aria-label={`Loading ${label.toLowerCase()}`}>
    <InputGroup variant="amount" aria-hidden="true">
      <div className="amount-line">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="amount-asset-skeleton w-28 rounded-full" />
      </div>
      <InputGroupAddon align="block-end">
        <div className="amount-meta">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-20" />
        </div>
      </InputGroupAddon>
    </InputGroup>
  </Field>;
}

export function AmountPanel({ token, icon, id: fieldId, label, value, usd, balance, loading, invalid, onChange, onAssetClick }: Props) {
  const id = fieldId ?? (token === 'WETH' ? 'collateral-amount' : 'borrow-amount');
  return <Field data-invalid={invalid || undefined} className="gap-0">
    <FieldLabel className="sr-only" htmlFor={id}>{label}</FieldLabel>
    <InputGroup variant="amount" aria-label={label} data-asset={token}>
      <div className="amount-line">
        <InputGroupInput id={id} aria-label={label} inputMode="decimal" autoComplete="off"
          placeholder="0.00" value={value} aria-invalid={invalid || undefined} aria-describedby={invalid ? 'borrow-wallet-balance-alert' : undefined}
          onChange={(e) => onChange(e.target.value)} />
        <InputGroupAddon align="inline-end">
          <Button variant="asset" size="asset" onClick={onAssetClick} type="button" aria-haspopup="dialog" aria-label={`Select ${label.toLowerCase().includes('debt') ? 'debt' : 'collateral'} asset`}>
            <TokenMark token={token} icon={icon} />
            <span className="asset-label"><strong>{token}</strong></span>
          </Button>
        </InputGroupAddon>
      </div>
      <InputGroupAddon align="block-end">
        <div className="amount-meta">
          <span>{usd}</span>
          {loading ? <Skeleton className="h-4 w-20" role="status" aria-label="Loading wallet balance" /> : <span>Bal: {balance}</span>}
        </div>
      </InputGroupAddon>
    </InputGroup>
  </Field>;
}

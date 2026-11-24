import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...values: ClassValue[]) {
  return twMerge(clsx(values));
}

export function shortAddress(address: string | null | undefined) {
  if (!address) return 'Not connected';
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function formatAmount(value: string | number | null | undefined, maximumFractionDigits = 4) {
  if (value === null || value === undefined || value === '') return '0.00';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '0.00';
  return numeric.toLocaleString('en-US', { maximumFractionDigits });
}

export function formatUsd(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return 'USD unavailable';
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 'USD unavailable';
  return numeric.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
}

export const getHealthFactorColor = (value: number | string | null | undefined) => {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return 'text-muted-foreground';
  const hf = Number(value);
  if (!Number.isFinite(hf)) return 'text-muted-foreground';
  if (hf < 1) return 'text-red-500';
  if (hf < 1.5) return 'text-orange-500';
  if (hf < 2) return 'text-yellow-500';
  return 'text-green-500';
};

export function createIntentSalt() {
  if (typeof crypto === 'undefined' || !crypto.getRandomValues) throw new Error('Secure randomness is unavailable; cannot create a position intent.');
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `0x${Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')}` as `0x${string}`;
}

'use client';

import { useCallback, useEffect, useState } from 'react';
import { createIntentSalt } from '@/lib/utils';

export function useCreationIntent(chainId: number, owner?: string) {
  const [intent, setIntent] = useState<{ key: string; salt: `0x${string}` } | null>(null);
  const key = owner ? `aave-position:intent:${chainId}:${owner.toLowerCase()}` : null;
  useEffect(() => {
    if (!key) { setIntent(null); return; }
    const saved = window.sessionStorage.getItem(key) as `0x${string}` | null;
    const next = saved && /^0x[0-9a-f]{64}$/i.test(saved) ? saved : createIntentSalt();
    if (saved !== next) window.sessionStorage.setItem(key, next);
    setIntent({ key, salt: next });
  }, [key]);
  const reset = useCallback((consumedSalt: `0x${string}`) => {
    // A late receipt can retire only the intent that was actually submitted.
    if (!key || window.sessionStorage.getItem(key) !== consumedSalt) return;
    const next = createIntentSalt();
    window.sessionStorage.setItem(key, next);
    setIntent(current => current?.key === key && current.salt === consumedSalt ? { key, salt: next } : current);
    return next;
  }, [key]);
  return { salt: intent?.key === key ? intent?.salt ?? null : null, reset };
}

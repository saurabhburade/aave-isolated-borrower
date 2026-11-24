'use client';
import { useState } from 'react';
import Image from 'next/image';
import { BadgeQuestionMark } from 'lucide-react';

function trustedIcon(icon?: string) {
  if (!icon) return undefined;
  try {
    const url = new URL(icon);
    return url.protocol === 'https:' && !url.port && !url.username && !url.password
      && (url.hostname === 'images.aave.com' || (url.hostname === 'token-logos.family.co' && url.pathname === '/asset')) ? icon : undefined;
  } catch { return undefined; }
}

export function TokenMark({ token, icon }: { token: string; icon?: string }) {
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const symbol = token.trim();
  const aaveIcon = symbol && symbol !== '?' ? `https://app.aave.com/icons/tokens/${encodeURIComponent(symbol.toLowerCase())}.svg` : undefined;
  // Prefer Aave's symbol-based SVG, then the catalog artwork URL.
  // Exhausted image sources fall back to the local Lucide icon.
  const source = [aaveIcon, trustedIcon(icon)].find(candidate => candidate && !failedSources.includes(candidate));
  return <span className="token-mark" aria-hidden="true">
    {source ? <Image key={source} src={source} alt="" width={36} height={36} loading="lazy" referrerPolicy="no-referrer" onError={() => setFailedSources(previous => [...previous, source])} /> : symbol && symbol !== '?' ? <span className="token-art-fallback"><BadgeQuestionMark size={20} strokeWidth={1.5} /></span> : <span className="token-mark-placeholder skeleton-shimmer" />}
  </span>;
}

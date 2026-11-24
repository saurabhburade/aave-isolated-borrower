// Adapted from Minidenticons (MIT), © 2021 Laurent Payot.
// https://github.com/laurentpayot/minidenticons — see docs/licenses/Minidenticons-LICENSE.
export function AccountAvatar({ address }: { address: string }) {
  const seed = address.toLowerCase();
  const hash = seed.split('').reduce((value, char) => (value ^ char.charCodeAt(0)) * -5, 5) >>> 2;

  return <svg className="portfolio-account-avatar" viewBox="-1.5 -1.5 8 8" width="34" height="34" fill={`hsl(${(hash % 9) * 40} 65% 55%)`} shapeRendering="crispEdges" aria-hidden="true" focusable="false">
    {Array.from({ length: 25 }, (_, i) => hash & (1 << (i % 15)) ? <rect key={i} x={i > 14 ? 7 - Math.floor(i / 5) : Math.floor(i / 5)} y={i % 5} width="1" height="1" /> : null)}
  </svg>;
}

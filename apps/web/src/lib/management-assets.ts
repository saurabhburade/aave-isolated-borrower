import type { Asset, Position } from './domain.ts';
import type { CatalogMarket } from './market-catalog.ts';

export function managementSupplyAssets(position: Position | null, markets: CatalogMarket[]): Asset[] {
  if (!position) return [];
  const market = markets.find(candidate => candidate.chainId === (position.chainId === 31337 ? 1 : position.chainId)
    && candidate.version === position.market.version && candidate.venue.toLowerCase() === position.market.venue.toLowerCase());
  if (!market) return [];
  const supplied = new Set(position.collaterals.filter(balance => Number(balance.amount) > 0).map(balance => balance.asset.id));
  const tokens = new Map<string, Asset>();
  for (const asset of position.market.assets) {
    const address = asset.address.toLowerCase();
    const eligible = market.reserves.some(reserve => reserve.address.toLowerCase() === address
      && reserve.reserveId === asset.reserveId && reserve.canSupply && reserve.canCollateral);
    if (!eligible) continue;
    // Keep the execution identity while presenting one choice per underlying token.
    const current = tokens.get(address);
    if (!current || !supplied.has(current.id) && supplied.has(asset.id)) tokens.set(address, asset);
  }
  return [...tokens.values()];
}

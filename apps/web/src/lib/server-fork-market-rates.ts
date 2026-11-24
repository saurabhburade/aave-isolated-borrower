import type { Address, PublicClient } from 'viem';
import type { CatalogMarket, IndexedMarketRates } from './market-catalog.ts';
import { v3PoolAbi, v4HubAbi, v4SpokeAbi } from './abis.ts';
import { createLocalClient } from './deployment.ts';
import { mapRpc } from './rpc-batch.ts';

/** Browse rates from the chain on which local transactions actually execute. */
export function createForkMarketRatesLoader(client: PublicClient = createLocalClient()) {
  const cache = new Map<string, { expires: number; value: Promise<IndexedMarketRates> }>();
  return async (markets: CatalogMarket[], debtAddress: string): Promise<IndexedMarketRates> => {
    const candidates = markets.flatMap(market => market.reserves
      .filter(reserve => reserve.canBorrow && reserve.address.toLowerCase() === debtAddress.toLowerCase())
      .map(reserve => ({ market, reserve })));
    if (!candidates.length) return { rates: [], errors: [] };
    const [chainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
    if (chainId !== 31337) throw new Error('Local borrow rates require chain 31337.');
    const key = JSON.stringify([block.hash, candidates.map(({ market, reserve }) => `${market.id}/${reserve.reserveId ?? ''}/${reserve.address.toLowerCase()}`).sort()]);
    for (const [oldKey, entry] of cache) if (entry.expires <= Date.now()) cache.delete(oldKey);
    const active = cache.get(key);
    if (active) return active.value;
    const value = (async (): Promise<IndexedMarketRates> => {
      const errors: string[] = [];
      const rates = await mapRpc(candidates, async ({ market, reserve }) => {
        let borrowRateRay: string | undefined;
        try {
          if (market.version === 3) {
            const data = await client.readContract({ address: market.venue, abi: v3PoolAbi, functionName: 'getReserveData', args: [reserve.address as Address], blockNumber: block.number });
            if (/^0x0{40}$/i.test(data[10])) throw new Error('Reserve is not borrowable on the fork');
            borrowRateRay = BigInt(data[4]).toString();
          } else {
            if (reserve.reserveId == null) throw new Error('Missing reserve ID');
            const mapping = await client.readContract({ address: market.venue, abi: v4SpokeAbi, functionName: 'getReserve', args: [BigInt(reserve.reserveId)], blockNumber: block.number });
            if (mapping[0].toLowerCase() !== reserve.address.toLowerCase()) throw new Error('Reserve token mismatch');
            const rate = await client.readContract({ address: mapping[1], abi: v4HubAbi, functionName: 'getAssetDrawnRate', args: [BigInt(mapping[2])], blockNumber: block.number });
            borrowRateRay = rate.toString();
          }
          const apy = Math.expm1(Number(borrowRateRay) / 1e27);
          if (!Number.isFinite(apy) || apy < 0) throw new Error('Invalid rate');
          return { marketId: market.id, reserveId: reserve.reserveId, borrowApy: apy.toString(), borrowRateRay, observedAt: new Date().toISOString() };
        } catch {
          errors.push(`${market.name} borrowing rate is unavailable on the local fork. Try refreshing.`);
          return { marketId: market.id, reserveId: reserve.reserveId, borrowApy: null, observedAt: new Date().toISOString() };
        }
      });
      return { rates, errors };
    })();
    const entry = { expires: Infinity, value };
    cache.set(key, entry);
    if (cache.size > 128) cache.delete(cache.keys().next().value!);
    try { const result = await value; entry.expires = Date.now() + (result.errors.length ? 0 : 15_000); return result; }
    catch (error) { cache.delete(key); throw error; }
  };
}

export const getForkMarketRates = createForkMarketRatesLoader();

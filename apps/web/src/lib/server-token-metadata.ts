import type { Asset } from './domain.ts';

export const AAVE_TOKEN_ENDPOINT = 'https://api.v4.aave.com/graphql';
// The supported Anvil deployment forks Ethereum mainnet; 31337 is not an API chain.
const SOURCE_CHAIN_ID = 1;
const CACHE_MS = 60 * 60 * 1000;
const RETRY_MS = 30 * 1000;
const TOKEN_QUERY = `query TokenMetadata($request: SwappableTokensRequest!) {
  swappableTokens(request: $request) {
    ... on Erc20Token { address chain { chainId } info { name icon decimals } }
  }
}`;

interface TokenMetadata {
  address: string;
  chain: { chainId: number };
  info: { name: string; icon: string; decimals: number };
}

/** Enrich verified reserves only; the public catalog never grants market support. */
export function createTokenMetadataLoader(fetcher: typeof fetch = fetch) {
  const cache = new Map<string, { expires: number; value: Promise<Map<string, TokenMetadata>> }>();

  async function load(addresses: string[]) {
    const key = addresses.join(',');
    const cached = cache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
    const entry = { expires: Date.now() + CACHE_MS, value: Promise.resolve(new Map<string, TokenMetadata>()) };
    entry.value = (async () => {
      try {
        // Explicit tokens supplement Aave's default list with all our local reserves.
        const variables = { request: { query: { tokens: addresses.map(address => ({ chainId: SOURCE_CHAIN_ID, address })) } } };
        const response = await fetcher(AAVE_TOKEN_ENDPOINT, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ query: TOKEN_QUERY, variables }),
          signal: AbortSignal.timeout(5_000), cache: 'no-store',
        });
        if (!response.ok) throw new Error(`Token metadata HTTP ${response.status}`);
        const result = await response.json() as { data?: { swappableTokens?: (TokenMetadata | null)[] }; errors?: unknown[] };
        if (!Array.isArray(result.data?.swappableTokens) || result.errors?.length) throw new Error('Token metadata unavailable');
        const tokens = new Map<string, TokenMetadata>();
        for (const token of result.data.swappableTokens) {
          if (token?.chain?.chainId !== SOURCE_CHAIN_ID || typeof token.address !== 'string' || !token.info) continue;
          tokens.set(token.address.toLowerCase(), token);
        }
        return tokens;
      } catch {
        // Metadata outages must not hide usable native reserves or block quotes.
        entry.expires = Date.now() + RETRY_MS;
        return new Map<string, TokenMetadata>();
      }
    })();
    cache.set(key, entry);
    return entry.value;
  }

  return async (assets: Asset[]): Promise<Asset[]> => {
    if (!assets.length) return assets;
    const addresses = [...new Set(assets.map(asset => asset.address.toLowerCase()))].sort();
    const tokens = await load(addresses);
    return assets.map(asset => {
      const token = tokens.get(asset.address.toLowerCase());
      if (!token || token.info.decimals !== asset.decimals) return asset;
      return {
        ...asset,
        name: typeof token.info.name === 'string' && token.info.name.trim() ? token.info.name : asset.name,
        icon: typeof token.info.icon === 'string' && token.info.icon.startsWith('https://images.aave.com/') ? token.info.icon : asset.icon,
      };
    });
  };
}

export const enrichTokenMetadata = createTokenMetadataLoader();

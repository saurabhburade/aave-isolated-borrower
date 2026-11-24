import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createPublicClient, http, keccak256, type Address, type Hex, type PublicClient } from 'viem';
import type { Asset, CreationDeployment, Freshness, Market, ProtocolVersion } from './domain.ts';
import { LOCAL_CHAIN_ID, LOCAL_RPC_URL, normalizeAddress } from './validation.ts';

export interface MarketDefinition {
  preferredDebtReserveIds?: string[];
  id?: string; version: ProtocolVersion; venue: Address; name: string; network?: string;
  verifiedBlock?: string; revision?: string; venueCodeHash?: Hex; implementation?: Address; implementationCodeHash?: Hex; reserveIds?: string[]; assets?: Array<{ id?: string; address: Address; symbol: string; name?: string; decimals: number; reserveId?: string }>;
}
export interface ManifestMarket extends MarketDefinition { verifiedBlock: string; revision: string; venueCodeHash: Hex }
export interface DeploymentManifest { chainId: number; rpcUrl: string; forkBlock: string; factory: Address; factoryCodeHash: Hex; factoryImplementationAddress?: Address; factoryImplementationCodeHash?: Hex; markets: ManifestMarket[] }
export interface DeploymentState { manifest: DeploymentManifest | null; reason?: string }

const manifestCandidates = () => [
  process.env.AAVE_DEPLOYMENT_MANIFEST,
  path.resolve(process.cwd(), '../../contracts/config/local.json'),
].filter((value): value is string => Boolean(value));

export async function loadDeploymentManifest(): Promise<DeploymentState> {
  for (const file of manifestCandidates()) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8')) as DeploymentManifest;
      if (parsed.chainId !== LOCAL_CHAIN_ID || !/^https?:\/\/(127\.0\.0\.1|localhost):8557$/.test(parsed.rpcUrl)) continue;
      if (!normalizeAddress(parsed.factory, 'factory') || !parsed.factoryCodeHash || !Array.isArray(parsed.markets)) continue;
      return { manifest: parsed };
    } catch { /* absent/invalid manifests are an unavailable state, not demo data */ }
  }
  return { manifest: null, reason: 'No verified local deployment manifest is available.' };
}

export function createLocalClient(url = process.env.ANVIL_RPC_URL ?? LOCAL_RPC_URL): PublicClient {
  if (!/^https?:\/\/(127\.0\.0\.1|localhost):8557$/.test(url)) throw new Error('Only the local RPC on port 8557 is permitted.');
  return createPublicClient({ transport: http(url, { timeout: 120_000, retryCount: 0 }) });
}

async function bytecodeMatches(client: PublicClient, address: Address, expected: Hex): Promise<boolean> {
  const bytecode = await client.getBytecode({ address });
  return Boolean(bytecode && keccak256(bytecode) === expected);
}

const ERC1967_IMPLEMENTATION_SLOT = '0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc' as Hex;

export async function verifyCodeHash(client: PublicClient, address: Address, expected: Hex): Promise<boolean> {
  return bytecodeMatches(client, address, expected);
}

export async function verifyDeploymentCode(client: PublicClient, address: Address, expectedProxyHash: Hex, implementationAddress?: Address, implementationCodeHash?: Hex): Promise<boolean> {
  if (!(await bytecodeMatches(client, address, expectedProxyHash))) return false;
  if (!implementationAddress && !implementationCodeHash) return true;
  if (!implementationAddress || !implementationCodeHash) return false;
  const slotValue = await client.getStorageAt({ address, slot: ERC1967_IMPLEMENTATION_SLOT });
  if (!slotValue) return false;
  const actualImplementation = `0x${slotValue.slice(-40)}`.toLowerCase();
  if (actualImplementation !== implementationAddress.toLowerCase()) return false;
  return bytecodeMatches(client, implementationAddress, implementationCodeHash);
}

export function marketId(chainId: number, version: ProtocolVersion, venue: Address): string {
  return `${chainId}/${version === 3 ? 'v3' : 'v4'}/${venue.toLowerCase()}`;
}

export function manifestAsset(market: MarketDefinition, asset: NonNullable<MarketDefinition['assets']>[number]): Asset {
  const tokenId = `${LOCAL_CHAIN_ID}/${asset.address.toLowerCase()}`;
  const reserve = market.version === 4 && asset.reserveId !== undefined ? `${asset.reserveId}/` : '';
  return { id: asset.id ?? `${marketId(LOCAL_CHAIN_ID, market.version, market.venue)}/${reserve}${asset.address.toLowerCase()}`, address: asset.address, symbol: asset.symbol, name: asset.name ?? asset.symbol, decimals: asset.decimals, tokenId, ...(asset.reserveId ? { reserveId: asset.reserveId } : {}) };
}

export function unavailableFreshness(reason: string): Freshness {
  return { status: 'unavailable', observedAt: null, blockNumber: null, reason };
}

export function unavailableMarket(raw: MarketDefinition, reason: string): Market {
  return { preferredDebtReserveIds: raw.preferredDebtReserveIds, id: marketId(LOCAL_CHAIN_ID, raw.version, raw.venue), chainId: LOCAL_CHAIN_ID, version: raw.version, venue: raw.venue, name: raw.name, network: raw.network ?? 'Anvil fork', assets: (raw.assets ?? []).map((asset) => manifestAsset(raw, asset)), status: 'unavailable', reason, verifiedBlock: raw.verifiedBlock, revision: raw.revision };
}

/** Load the exact account creation code embedded in the pinned factory build. */
export async function loadCreationDeployment(manifest: DeploymentManifest | null): Promise<CreationDeployment | null> {
  if (!manifest) return null;
  try {
    const root = path.resolve(process.cwd(), '../../contracts/out');
    const [factory, account] = await Promise.all([
      readFile(path.join(root, 'PositionFactory.sol/PositionFactory.json'), 'utf8').then(JSON.parse),
      readFile(path.join(root, 'PositionAccount.sol/PositionAccount.json'), 'utf8').then(JSON.parse),
    ]);
    if (keccak256(factory.deployedBytecode.object) !== manifest.factoryCodeHash) return null;
    const accountCreationCode = account.bytecode.object;
    if (typeof accountCreationCode !== 'string' || !/^0x[0-9a-f]+$/i.test(accountCreationCode)) return null;
    return { factory: manifest.factory, accountCreationCode: accountCreationCode as Hex };
  } catch { return null; }
}

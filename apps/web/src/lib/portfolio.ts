import { formatUnits, parseAbiItem, type Address, type Hex, type PublicClient } from 'viem';
import type { Activity, Position } from './domain.ts';
import { accountAbi, factoryAbi } from './abis.ts';
import { createLocalClient, loadDeploymentManifest, marketId, type ManifestMarket } from './deployment.ts';
import { discoverMarkets } from './discovery.ts';
import { positionReserveTokens, readNativePosition } from './native.ts';
import { mapRpc } from './rpc-batch.ts';
import { LOCAL_CHAIN_ID, localAddress } from './validation.ts';

const positionCreatedEvent = parseAbiItem('event PositionCreated(address indexed owner,address indexed account,address indexed venue,uint8 version,bytes32 salt)');
const actionEvent = parseAbiItem('event PositionAction(address indexed owner,uint8 indexed kind,address indexed token,uint256 reserveId,uint256 amount,bool enabled)');
const executedEvent = parseAbiItem('event AccountExecuted(address indexed owner,uint256 actionCount)');
type PositionActionLog = { args: { kind: number; token: Address; reserveId: bigint; amount: bigint; enabled: boolean }; blockNumber: bigint; transactionHash: Hex; logIndex: number };


function unknownPosition(manifest: Pick<ManifestMarket, 'version' | 'venue' | 'name'> & Partial<Pick<ManifestMarket, 'network' | 'verifiedBlock' | 'revision'>>, account: Address, owner: Address, salt: Hex, reason: string): Position {
  const market = { id: marketId(LOCAL_CHAIN_ID, manifest.version, manifest.venue), chainId: LOCAL_CHAIN_ID, version: manifest.version, venue: manifest.venue, name: manifest.name, network: manifest.network ?? 'Anvil fork', assets: [], status: 'unavailable' as const, reason, verifiedBlock: manifest.verifiedBlock, revision: manifest.revision };
  return { id: `${LOCAL_CHAIN_ID}/${account.toLowerCase()}`, chainId: LOCAL_CHAIN_ID, account, owner, market, salt, collaterals: [], debts: [], risk: { healthFactor: null, ltv: null, borrowCapacityUsd: null, collateralUsd: null, debtUsd: null, riskPremiumBps: null }, freshness: { status: 'unavailable', observedAt: null, blockNumber: null, reason }, activity: [], status: 'unknown' };
}

export async function loadPortfolio(ownerValue: unknown, chainId = LOCAL_CHAIN_ID, client = createLocalClient()): Promise<{ positions: Position[]; freshness: Position['freshness'] }> {
  const owner = localAddress(ownerValue, 'owner');
  if (chainId !== LOCAL_CHAIN_ID) throw new Error('Only the verified local chain is available.');
  const state = await loadDeploymentManifest();
  if (!state.manifest) return { positions: [], freshness: { status: 'unavailable', observedAt: null, blockNumber: null, reason: state.reason } };
  const [actualChainId, block] = await Promise.all([client.getChainId(), client.getBlock()]);
  if (actualChainId !== LOCAL_CHAIN_ID) throw new Error('RPC chain does not match the requested chain.');
  const created = await client.getLogs({ address: state.manifest.factory, event: positionCreatedEvent, strict: true, args: { owner }, fromBlock: BigInt(state.manifest.forkBlock) + 1n, toBlock: block.number });
  const marketIds = [...new Set(created.map(log => marketId(LOCAL_CHAIN_ID, Number(log.args.version) as 3 | 4, log.args.venue as Address)))];
  const discovery = await discoverMarkets(client, { marketIds: undefined, summary: true });
  const recognized = marketIds.filter(id => discovery.details.has(id));
  const actionsByAccount = new Map<Address, PositionActionLog[]>();
  const tokensByMarket = new Map<string, Set<Address>>();
  const completeInventory = new Set<string>();
  await mapRpc(created, async log => {
    const id = marketId(LOCAL_CHAIN_ID, Number(log.args.version) as 3 | 4, log.args.venue);
    const candidate = discovery.details.get(id);
    if (!candidate) return;
    try {
      const actions = await client.getLogs({ address: log.args.account, event: actionEvent, strict: true, fromBlock: log.blockNumber, toBlock: block.number });
      actionsByAccount.set(log.args.account, actions);
      const tokens = await positionReserveTokens(client, candidate.market, log.args.account, actions.map(action => action.args.token), block.number);
      if (!tokens) { completeInventory.add(id); return; }
      const selected = tokensByMarket.get(id) ?? new Set<Address>();
      tokens.forEach(token => selected.add(token));
      tokensByMarket.set(id, selected);
    } catch { completeInventory.add(id); }
  });
  const inventories = await mapRpc(recognized, async id => discoverMarkets(client, { marketIds: [id], assetIds: completeInventory.has(id) ? undefined : [...tokensByMarket.get(id) ?? []] }));
  const details = new Map(inventories.flatMap(inventory => [...inventory.details]));
  const positions: Position[] = [];
  for (const log of created) {
    const account = log.args.account as Address;
    const venue = log.args.venue as Address;
    const version = Number(log.args.version) as 3 | 4;
    const salt = log.args.salt as Hex;
    const detail = details.get(marketId(LOCAL_CHAIN_ID, version, venue));
    if (!detail) {
      const manifest = state.manifest.markets.find((candidate) => candidate.version === version && candidate.venue.toLowerCase() === venue.toLowerCase());
      positions.push(unknownPosition(manifest ?? { version, venue, name: `Aave V${version} market` }, account, owner, salt, 'Position market was not discoverable at the current block.'));
      continue;
    }
    try {
      const [actualOwner, actualVersion, actualVenue, actualChainId, actualSalt, stateData, actions, executions] = await Promise.all([
        client.readContract({ address: account, abi: accountAbi, functionName: 'owner', blockNumber: block.number }),
        client.readContract({ address: account, abi: accountAbi, functionName: 'version', blockNumber: block.number }),
        client.readContract({ address: account, abi: accountAbi, functionName: 'venue', blockNumber: block.number }),
        client.readContract({ address: account, abi: accountAbi, functionName: 'chainId', blockNumber: block.number }),
        client.readContract({ address: account, abi: accountAbi, functionName: 'salt', blockNumber: block.number }),
        readNativePosition(client, detail, account, owner, salt, block.number),
        actionsByAccount.get(account) ?? client.getLogs({ address: account, event: actionEvent, strict: true, fromBlock: log.blockNumber, toBlock: block.number }),
        client.getLogs({ address: account, event: executedEvent, strict: true, fromBlock: log.blockNumber, toBlock: block.number }),
      ]);
      if (actualOwner.toLowerCase() !== owner.toLowerCase() || Number(actualVersion) !== version || actualVenue.toLowerCase() !== venue.toLowerCase() || Number(actualChainId) !== LOCAL_CHAIN_ID || actualSalt.toLowerCase() !== salt.toLowerCase()) throw new Error('Position account immutable binding does not match its creation event.');
      const actionBlocks = new Map<bigint, number>();
      for (const event of actions) actionBlocks.set(event.blockNumber, 0);
      await Promise.all([...actionBlocks.keys()].map(async (blockNumber) => { const eventBlock = await client.getBlock({ blockNumber }); actionBlocks.set(blockNumber, Number(eventBlock.timestamp)); }));
      const activity: Activity[] = actions.map((event) => ({ id: `${LOCAL_CHAIN_ID}:${event.transactionHash}:${event.logIndex}`, kind: ['Supply', 'Withdraw', 'Borrow', 'Repay', event.args.enabled ? 'Collateral enabled' : 'Collateral disabled', 'Risk refreshed'][Number(event.args.kind)] ?? 'Protocol action', assetSymbol: detail.market.assets.find((asset) => asset.address.toLowerCase() === String(event.args.token).toLowerCase())?.symbol, amount: formatUnits(event.args.amount, detail.market.assets.find(asset => asset.address.toLowerCase() === event.args.token.toLowerCase())?.decimals ?? 0), transactionHash: event.transactionHash, timestamp: new Date((actionBlocks.get(event.blockNumber) ?? 0) * 1000).toISOString(), blockNumber: event.blockNumber.toString() }));
      const allAssets = discovery.details.get(detail.market.id)?.market.assets;
      const assets = allAssets?.length && allAssets.every(asset => asset.id.startsWith(`${detail.market.id}/`)) ? allAssets : detail.market.assets;
      positions.push({ id: `${LOCAL_CHAIN_ID}/${account.toLowerCase()}`, chainId: LOCAL_CHAIN_ID, account, owner, market: { ...detail.market, assets }, salt, ...stateData, activity, status: executions.length > 0 && stateData.status === 'empty' ? 'closed' : stateData.status });
    } catch (error) {
      positions.push(unknownPosition(detail.market, account, owner, salt, error instanceof Error ? error.message : 'Native position read failed.'));
    }
  }
  return { positions, freshness: { status: discovery.freshness.status, observedAt: new Date().toISOString(), blockNumber: block.number.toString(), ...(discovery.freshness.reason ? { reason: discovery.freshness.reason } : {}) } };
}

export async function loadPosition(accountValue: unknown, ownerValue: unknown, chainId = LOCAL_CHAIN_ID, client = createLocalClient()): Promise<{ position: Position | null; freshness: Position['freshness'] }> {
  const account = localAddress(accountValue, 'account');
  const owner = localAddress(ownerValue, 'owner');
  const portfolio = await loadPortfolio(owner, chainId, client);
  const position = portfolio.positions.find((candidate) => candidate.account.toLowerCase() === account.toLowerCase()) ?? null;
  return { position, freshness: portfolio.freshness };
}

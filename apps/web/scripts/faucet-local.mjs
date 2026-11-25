// Disposable local-fork faucet. It changes only the owner's ERC20 balance mappings.
import { writeFile } from 'node:fs/promises';
import { encodeAbiParameters, encodeFunctionData, formatUnits, getAddress, keccak256, parseAbi, parseAbiParameters, parseUnits, toHex } from 'viem';
import { getMarkets } from '../src/lib/api.ts';
import { createLocalClient } from '../src/lib/deployment.ts';
import { erc20Abi } from '../src/lib/abis.ts';
import { discoverMarkets } from '../src/lib/discovery.ts';
import { getMarketCatalog } from '../src/lib/server-market-catalog.ts';

const client = createLocalClient();
if (await client.getChainId() !== 31337) throw new Error('Faucet requires local Anvil chain 31337.');
const accounts = await client.request({ method: 'eth_accounts', params: [] });
const owner = getAddress(process.env.LOCAL_OWNER ?? accounts[0]);
if (!accounts.some(account => account.toLowerCase() === owner.toLowerCase())) throw new Error('Faucet owner must be an unlocked local Anvil account.');
const requestedTokens = process.env.LOCAL_FAUCET_TOKENS?.split(',').map(symbol => symbol.trim()).filter(Boolean);
const catalog = await getMarkets(Boolean(requestedTokens?.length));
if (requestedTokens?.length) {
  if (requestedTokens.some(symbol => !catalog.assets.some(asset => asset.symbol === symbol))) {
    const official = await getMarketCatalog(1);
    const markets = official.markets.filter(market => market.chainId === 1 && !market.isTestnet
      && market.reserves.some(reserve => requestedTokens.includes(reserve.symbol)));
    const assetIds = markets.flatMap(market => market.reserves.filter(reserve => requestedTokens.includes(reserve.symbol)).map(reserve => reserve.address));
    if (!assetIds.length) throw new Error('A requested faucet token is not in the official Ethereum catalog.');
    const native = await discoverMarkets(client, {
      marketIds: markets.map(market => `31337/v${market.version}/${market.venue.toLowerCase()}`),
      assetIds,
    });
    catalog.assets = native.assets;
    catalog.freshness = native.freshness;
  }
  catalog.assets = catalog.assets.filter(asset => requestedTokens.includes(asset.symbol));
  if (requestedTokens.some(symbol => !catalog.assets.some(asset => asset.symbol === symbol))) throw new Error('A requested faucet token is not in the verified catalog.');
}
if (!catalog.assets.length || catalog.freshness.status !== 'fresh' || (!requestedTokens?.length && catalog.markets.some(market => market.status !== 'available'))) throw new Error('A verified native token inventory is required.');
const slots = Array.from({ length: 256 }, (_, index) => BigInt(index));
// ERC-7201 OpenZeppelin ERC20 namespace, used by current upgradeable tokens.
const erc20Namespace = BigInt(keccak256(encodeAbiParameters(parseAbiParameters('uint256'), [BigInt(keccak256(toHex('openzeppelin.storage.ERC20'))) - 1n]))) & ~255n;
slots.push(erc20Namespace);
const ownerSlots = new Set(slots.flatMap(slot => [
  keccak256(encodeAbiParameters(parseAbiParameters('address,uint256'), [owner, slot])),
  keccak256(encodeAbiParameters(parseAbiParameters('uint256,address'), [slot, owner])),
]).map(slot => slot.toLowerCase()));
const readBalance = asset => client.readContract({ address: asset.address, abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
const readSupply = asset => client.readContract({ address: asset.address, abi: erc20Abi, functionName: 'totalSupply' });
const ethBefore = await client.getBalance({ address: owner });
if (ethBefore < parseUnits('10000', 18)) await client.request({ method: 'anvil_setBalance', params: [owner, toHex(parseUnits('10000', 18))] });
const amountFor = symbol => /BTC|LBTC|FBTC/i.test(symbol) ? '100' : /ETH/i.test(symbol) ? '1000' : /USD|DAI|FRAX|LUSD|GHO|EURC/i.test(symbol) ? '1000000' : symbol === 'XAUt' ? '100' : '10000';
const results = [];

for (const asset of catalog.assets) {
  const target = parseUnits(amountFor(asset.symbol), asset.decimals);
  const before = await readBalance(asset);
  try {
    if (before < target) {
      const data = encodeFunctionData({ abi: erc20Abi, functionName: 'balanceOf', args: [owner] });
      const trace = await client.request({ method: 'debug_traceCall', params: [{ to: asset.address, data }, 'latest', { tracer: 'prestateTracer', tracerConfig: { disableCode: true } }] });
      const ledgers = new Set([asset.address.toLowerCase()]);
      if (asset.symbol === 'SNX') {
        const tokenStateAbi = parseAbi(['function tokenState() view returns (address)', 'function target() view returns (address)']);
        let ledger = await client.readContract({ address: asset.address, abi: tokenStateAbi, functionName: 'tokenState' }).catch(() => null);
        if (!ledger) {
          const implementation = await client.readContract({ address: asset.address, abi: tokenStateAbi, functionName: 'target' });
          ledger = await client.readContract({ address: implementation, abi: tokenStateAbi, functionName: 'tokenState' });
        }
        ledgers.add(ledger.toLowerCase());
      }
      const candidatesFor = () => Object.entries(trace).filter(([address]) => ledgers.has(address.toLowerCase())).flatMap(([address, state]) => Object.entries(state.storage ?? {}).filter(([slot]) => ownerSlots.has(slot.toLowerCase())).map(([slot, previous]) => ({ address, slot, previous })));
      let candidates = candidatesFor();
      if (!candidates.length) {
        // Derive custom mapping locations from the actual owner-containing hash
        // input. Only keys read by balanceOf and containing this owner qualify.
        const steps = await client.request({ method: 'debug_traceCall', params: [{ to: asset.address, data }, 'latest', { enableMemory: true, disableStorage: true }] });
        for (const step of steps.structLogs ?? []) {
          if (!['SHA3', 'KECCAK256'].includes(step.op) || !step.memory?.length) continue;
          const integer = value => BigInt(value.startsWith('0x') ? value : `0x${value}`);
          const offset = Number(integer(step.stack.at(-1)));
          const size = Number(integer(step.stack.at(-2)));
          if (size < 20 || size > 128) continue;
          const memory = step.memory.map(word => word.replace(/^0x/, '')).join('');
          const input = memory.slice(offset * 2, (offset + size) * 2);
          if (input.toLowerCase().includes(owner.slice(2).toLowerCase())) ownerSlots.add(keccak256(`0x${input}`).toLowerCase());
        }
        candidates = candidatesFor();
      }
      const supplyBefore = await readSupply(asset);
      let funded = false;
      for (const { address: ledger, slot, previous } of candidates) {
        let raw = target;
        try {
          for (let attempt = 0; attempt < 4; attempt += 1) {
            await client.request({ method: 'anvil_setStorageAt', params: [ledger, slot, toHex(raw, { size: 32 })] });
            const balance = await readBalance(asset);
            if (balance >= target && balance - target <= 10n) { funded = true; break; }
            if (balance === 0n) break;
            raw = (raw * target + balance - 1n) / balance;
          }
          if (funded && await readSupply(asset) !== supplyBefore) { funded = false; throw new Error('Token supply changed unexpectedly.'); }
          if (funded) break;
        } finally {
          if (!funded) await client.request({ method: 'anvil_setStorageAt', params: [ledger, slot, previous] });
        }
      }
      if (!funded && asset.address.toLowerCase() === '0x5a98fcbea516cf06857215779fd812ca3bef1b32') {
        // LDO MiniMe balances are owner-specific arrays of packed checkpoints.
        for (const { address: ledger, slot, previous } of candidates) {
          const length = BigInt(previous);
          const checkpointSlot = toHex(BigInt(keccak256(slot)) + length, { size: 32 });
          const previousCheckpoint = await client.getStorageAt({ address: ledger, slot: checkpointSlot }) ?? toHex(0n, { size: 32 });
          try {
            const block = await client.getBlockNumber({ cacheTime: 0 });
            const checkpoint = target << 128n | block;
            await client.request({ method: 'anvil_setStorageAt', params: [ledger, checkpointSlot, toHex(checkpoint, { size: 32 })] });
            await client.request({ method: 'anvil_setStorageAt', params: [ledger, slot, toHex(length + 1n, { size: 32 })] });
            funded = await readBalance(asset) === target && await readSupply(asset) === supplyBefore;
            if (funded) break;
          } finally {
            if (!funded) {
              await client.request({ method: 'anvil_setStorageAt', params: [ledger, slot, previous] });
              await client.request({ method: 'anvil_setStorageAt', params: [ledger, checkpointSlot, previousCheckpoint] });
            }
          }
        }
      }
      if (!funded) throw new Error(`No verified owner balance mapping found (${candidates.length} candidates).`);
    }
    const after = await readBalance(asset);
    if (after < target) throw new Error('Final native balance is below the faucet target.');
    results.push({ symbol: asset.symbol, address: asset.address, balance: formatUnits(after, asset.decimals), status: 'funded' });
    console.log(`${asset.symbol}: ${formatUnits(after, asset.decimals)}`);
  } catch (error) {
    results.push({ symbol: asset.symbol, address: asset.address, status: 'failed', error: error.message });
    console.error(`${asset.symbol}: ${error.message}`);
  }
}
const report = { chainId: 31337, rpc: 'http://127.0.0.1:8557', owner, eth: formatUnits(await client.getBalance({ address: owner }), 18), results };
await writeFile('/tmp/aave-local-faucet-balances.json', JSON.stringify(report, null, 2));
const failures = results.filter(result => result.status === 'failed');
console.log(`Verified ${results.length - failures.length}/${results.length} token balances for ${owner}; ETH ${report.eth}.`);
if (failures.length) process.exitCode = 1;

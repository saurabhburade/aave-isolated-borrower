import test from 'node:test';
import assert from 'node:assert/strict';
import type { Address, PublicClient } from 'viem';
import type { MarketDiscovery } from './discovery.ts';
import { readNativePosition } from './native.ts';
import { positionBorrowApy } from './portfolio-summary.ts';

const account = '0x0000000000000000000000000000000000000011';
const spoke = '0x0000000000000000000000000000000000000022';
const hub = '0x0000000000000000000000000000000000000033';
const token = '0x0000000000000000000000000000000000000044';
const salt = `0x${'0'.repeat(64)}` as const;
const ray = 10n ** 27n;
const asset = { id: 'usdc', address: token, symbol: 'USDC', name: 'USD Coin', decimals: 6, reserveId: '7' } as const;
const detail: MarketDiscovery = {
  market: { id: 'market', chainId: 31337, version: 4, venue: spoke, name: 'V4 Spoke', network: 'Anvil', assets: [asset], status: 'available' },
  reserves: [{ asset, canSupply: true, canBorrow: true, canCollateral: false, paused: false, frozen: false, supplyCap: null, borrowCap: null, liquidity: null, borrowRateRay: '1' }],
  freshness: { status: 'fresh', observedAt: null, blockNumber: '122' },
};

function rpc({ base = ray / 25n, premium = 2500n, failRate = false, debt = 1_000_000_000n } = {}) {
  const rateReads: string[] = [];
  const client = { readContract: async (call: { address: Address; functionName: string; args: readonly unknown[]; blockNumber: bigint }) => {
    assert.equal(call.blockNumber, 123n, 'rates and balances must use the same block');
    switch (call.functionName) {
      // Latest calculated premium differs from the stored premium actually accruing.
      case 'getUserAccountData': return [9000n, 8n * 10n ** 17n, 2n * 10n ** 18n, 2000n * 10n ** 26n, 1000n * 10n ** 53n, 1n, 1n];
      case 'getUserLastRiskPremium': return premium;
      case 'getUserSuppliedAssets': return 0n;
      case 'getUserTotalDebt': return debt;
      case 'getUserReserveStatus': return [false, debt > 0n];
      case 'getReserve':
        assert.deepEqual(call.args, [7n]);
        return [token, hub, 42n, 6, 0, 0, 0];
      case 'getAssetDrawnRate':
        assert.equal(call.address, hub);
        assert.deepEqual(call.args, [42n], 'Hub asset ID is not the Spoke reserve ID');
        rateReads.push(call.functionName);
        if (failRate) throw new Error('Rate RPC unavailable');
        return base;
      default: throw new Error(`Unexpected read: ${call.functionName}`);
    }
  } } as unknown as PublicClient;
  return { client, rateReads };
}

test('V4 position APY uses the RPC Hub rate and stored user risk premium', async () => {
  const { client, rateReads } = rpc();
  const state = await readNativePosition(client, detail, account, account, salt, 123n);
  assert.equal(state.debts[0].apy, Math.expm1(0.05).toString());
  assert.equal(positionBorrowApy({ ...state, id: 'position', chainId: 31337, account, owner: account, salt, market: detail.market, activity: [] }), Math.expm1(0.05));
  assert.equal(state.risk.riskPremiumBps, '2500');
  assert.equal(rateReads.length, 1);
});

test('V4 preserves genuine zero rates and zero risk premiums', async () => {
  for (const options of [{ base: 0n }, { premium: 0n }]) {
    const { client } = rpc(options);
    const state = await readNativePosition(client, detail, account, account, salt, 123n);
    assert.equal(state.debts[0].apy, Math.expm1(options.base === 0n ? 0 : 0.04).toString());
  }
});

test('a failed V4 rate read leaves APY unknown while retaining balances and risk', async () => {
  const { client } = rpc({ failRate: true });
  const state = await readNativePosition(client, detail, account, account, salt, 123n);
  assert.equal(state.debts[0].apy, null);
  assert.equal(state.debts[0].amount, '1000');
  assert.equal(state.freshness.status, 'fresh');
  assert.equal(state.risk.debtUsd, '1000');
});

test('V4 debt-free reserves do not request borrow rates', async () => {
  const { client, rateReads } = rpc({ debt: 0n });
  const state = await readNativePosition(client, detail, account, account, salt, 123n);
  assert.deepEqual(state.debts, []);
  assert.deepEqual(rateReads, []);
});

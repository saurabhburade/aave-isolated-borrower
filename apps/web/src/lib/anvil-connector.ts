import { createConnector } from 'wagmi';
import { getAddress, http, type EIP1193Parameters, type EIP1193RequestFn, type WalletRpcSchema } from 'viem';
import { LOCAL_CHAIN_ID, LOCAL_RPC_URL } from './validation.ts';

// The same disposable account funded by pnpm local:fund. No private key is used.
export const ANVIL_ACCOUNT = getAddress('0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
const connectionKey = 'anvilLocal.connected';

function assertLocalDevelopment() {
  if (process.env.NODE_ENV !== 'development' || typeof window === 'undefined'
    || !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname)) {
    throw new Error('Anvil Local is only available in development on localhost.');
  }
}

export function anvilConnector() {
  return createConnector((config) => {
    const rpc = http<WalletRpcSchema>(LOCAL_RPC_URL, { retryCount: 0, timeout: 10_000 })({});
    let connected = false;

    async function assertLocalChain() {
      assertLocalDevelopment();
      if (Number(await rpc.request({ method: 'eth_chainId' })) !== LOCAL_CHAIN_ID) {
        throw new Error('Anvil Local requires the local fork on chain 31337.');
      }
    }

    function assertConnected() {
      if (!connected) throw Object.assign(new Error('Connect Anvil Local before sending requests.'), { code: 4900 });
    }

    const request = (async (args: EIP1193Parameters<WalletRpcSchema>) => {
      const { method, params } = args;
      assertConnected();
      // Keep approval/signing feedback visible before the local node submits.
      if (method === 'eth_sendTransaction') await new Promise((resolve) => setTimeout(resolve, 1_500));
      // Recheck the node before every request, including every transaction.
      await assertLocalChain();
      assertConnected();
      if (method === 'eth_chainId') return '0x7a69';
      if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [ANVIL_ACCOUNT];
      if (method === 'eth_sendTransaction') {
        const transaction = params[0];
        if (transaction.from?.toLowerCase() !== ANVIL_ACCOUNT.toLowerCase()
          || ('chainId' in transaction && transaction.chainId !== undefined && Number(transaction.chainId) !== LOCAL_CHAIN_ID)) {
          throw new Error('Anvil Local can only send from its test account on chain 31337.');
        }
        return rpc.request(args);
      }
      if (method.startsWith('eth_get') || ['eth_call', 'eth_estimateGas', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory'].includes(method)) {
        return rpc.request(args);
      }
      throw Object.assign(new Error(`Anvil Local does not support ${method}.`), { code: 4200 });
    }) as EIP1193RequestFn<WalletRpcSchema>;
    const provider = { request };

    return {
      id: 'anvilLocal',
      name: 'Anvil Local',
      type: 'anvilLocal',
      async connect({ chainId, withCapabilities } = {}) {
        if (chainId !== undefined && chainId !== LOCAL_CHAIN_ID) throw new Error('Anvil Local only supports chain 31337.');
        await assertLocalChain();
        const accounts = await rpc.request({ method: 'eth_accounts' });
        if (!accounts.some((account) => account.toLowerCase() === ANVIL_ACCOUNT.toLowerCase())) {
          throw new Error('The funded Anvil test account is unavailable. Start the fork with pnpm fork.');
        }
        await config.storage?.setItem(connectionKey, true);
        connected = true;
        return {
          accounts: (withCapabilities ? [{ address: ANVIL_ACCOUNT, capabilities: {} }] : [ANVIL_ACCOUNT]) as never,
          chainId: LOCAL_CHAIN_ID,
        };
      },
      async disconnect() {
        connected = false;
        await config.storage?.removeItem(connectionKey);
      },
      async getAccounts() {
        assertConnected();
        await assertLocalChain();
        return [ANVIL_ACCOUNT];
      },
      async getChainId() {
        await assertLocalChain();
        return LOCAL_CHAIN_ID;
      },
      async getProvider({ chainId } = {}) {
        if (chainId !== undefined && chainId !== LOCAL_CHAIN_ID) throw new Error('Anvil Local only supports chain 31337.');
        return provider;
      },
      async isAuthorized() {
        try {
          if (!await config.storage?.getItem(connectionKey)) return false;
          await this.connect();
          return true;
        } catch {
          connected = false;
          return false;
        }
      },
      async switchChain({ chainId }) {
        const chain = config.chains.find((chain) => chain.id === chainId && chain.id === LOCAL_CHAIN_ID);
        if (!chain) throw new Error('Anvil Local only supports chain 31337.');
        await assertLocalChain();
        config.emitter.emit('change', { chainId });
        return chain;
      },
      onAccountsChanged(accounts) {
        if (!accounts.length || accounts[0].toLowerCase() !== ANVIL_ACCOUNT.toLowerCase()) this.onDisconnect();
        else config.emitter.emit('change', { accounts: [ANVIL_ACCOUNT] });
      },
      onChainChanged(chainId) {
        if (Number(chainId) !== LOCAL_CHAIN_ID) this.onDisconnect();
        else config.emitter.emit('change', { chainId: LOCAL_CHAIN_ID });
      },
      async onDisconnect() {
        await this.disconnect();
        config.emitter.emit('disconnect');
      },
    };
  });
}

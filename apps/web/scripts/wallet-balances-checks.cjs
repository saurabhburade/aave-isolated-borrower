const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { chromium } = require('playwright');
const { decodeFunctionData, encodeFunctionResult, erc20Abi, multicall3Abi } = require('viem');

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3210';
const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const secondOwner = '0x0000000000000000000000000000000000001234';
const multicall = '0xca11bde05977b3631167028862be2a173976ca11';
const token = n => '0x' + n.toString(16).padStart(40, '0');
const assets = Array.from({ length: 180 }, (_, index) => ({
  address: token(index + 1), symbol: index === 0 ? 'WETH' : index === 1 ? 'USDC' : `T${String(index + 1).padStart(3, '0')}`,
  name: index === 0 ? 'Wrapped Ether' : `Test token ${index + 1}`, decimals: index === 1 ? 6 : 18,
  canSupply: true, canCollateral: true, canBorrow: true, usdPrice: '1', maxLtv: '0.8', liquidationThreshold: '0.85',
}));
const catalog = { id: 'test-v3', chainId: 1, version: 3, venue: token(900), name: 'Test Aave market', network: 'Ethereum', isTestnet: false, reserves: assets };
let browser;
const errors = [];

(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(15_000);
  // Keep development HMR reloads from resetting the mock wallet during checks.
  await page.routeWebSocket('**/_next/webpack-hmr*', socket => socket.close());
  const reads = [];
  let wethBalance = 10n ** 18n;
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ owner }) => {
    let connected = false;
    let account = owner;
    const listeners = new Map();
    window.changeBalanceAccount = next => { account = next; for (const callback of listeners.get('accountsChanged') ?? []) callback([next]); };
    window.ethereum = {
      isMetaMask: true,
      on(event, callback) { listeners.set(event, [...listeners.get(event) ?? [], callback]); },
      removeListener(event, callback) { listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== callback)); },
      async request({ method }) {
        if (method === 'eth_requestAccounts') { connected = true; return [account]; }
        if (method === 'eth_accounts') return connected ? [account] : [];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'wallet_getCapabilities') return {};
        throw new Error(`Unexpected wallet method: ${method}`);
      },
    };
  }, { owner });
  await page.route('**/api/market-catalog?**', route => route.fulfill({ json: { markets: [catalog, { ...catalog, id: 'duplicate-market', venue: token(901) }], errors: [] } }));
  await page.route('**/api/markets?**', route => route.fulfill({ json: { markets: [], freshness: { status: 'unavailable', observedAt: null, blockNumber: null } } }));
  await page.route('**/api/market-rates?**', route => route.fulfill({ json: { rates: [], errors: [] } }));
  await page.route('**/api/rate-history?**', route => route.fulfill({ json: { series: [], errors: [] } }));
  await page.route('http://127.0.0.1:8557/**', async route => {
    const payload = route.request().postDataJSON();
    const results = (Array.isArray(payload) ? payload : [payload]).map(call => {
      let result;
      if (call.method === 'eth_chainId') result = '0x7a69';
      else if (call.method === 'eth_call') {
        assert.equal(call.params[0].to.toLowerCase(), multicall, 'balance RPC must use Multicall3');
        const { functionName, args } = decodeFunctionData({ abi: multicall3Abi, data: call.params[0].data });
        assert.equal(functionName, 'aggregate3');
        result = encodeFunctionResult({ abi: multicall3Abi, functionName, result: args[0].map(item => {
          const erc20 = decodeFunctionData({ abi: erc20Abi, data: item.callData });
          assert.equal(erc20.functionName, 'balanceOf');
          reads.push({ token: item.target.toLowerCase(), owner: erc20.args[0].toLowerCase() });
          const firstAccount = erc20.args[0].toLowerCase() === owner;
          const value = !firstAccount ? 0n : item.target.toLowerCase() === token(1) ? wethBalance : item.target.toLowerCase() === token(100) ? 7n * 10n ** 18n : 0n;
          return item.target.toLowerCase() === token(3) ? { success: false, returnData: '0x' }
            : { success: true, returnData: encodeFunctionResult({ abi: erc20Abi, functionName: 'balanceOf', result: value }) };
        }) });
      } else throw new Error(`Unexpected RPC: ${call.method}`);
      return { jsonrpc: '2.0', id: call.id, result };
    });
    await route.fulfill({ json: Array.isArray(payload) ? results : results[0] });
  });
  await page.goto(`${base}/31337`);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /MetaMask|Injected|Browser Wallet/i }).first().click();
  await page.waitForFunction(() => [...document.querySelectorAll('.amount-meta')].some(item => item.textContent.includes('Bal: 1.00')));
  await page.getByRole('button', { name: 'Select collateral asset', exact: true }).first().click();
  const picker = page.getByRole('dialog', { name: 'Select collateral asset 1' });
  const search = picker.getByLabel('Search tokens or paste address');
  await picker.getByLabel('WETH wallet balance').waitFor();
  assert.equal(await picker.getByLabel('WETH wallet balance').innerText(), '1.00');
  assert.ok(await picker.getByRole('option').count() < 35, 'large list renders only a window');
  assert.ok((await picker.getByRole('option').nth(1).innerText()).includes('T100'), 'funded tokens are ranked first');
  const selected = picker.getByRole('option', { selected: true });
  assert.equal(await selected.locator('svg').count(), 0, 'selected token has no checkmark');
  const activeBg = await selected.evaluate(element => getComputedStyle(element).backgroundColor);
  assert.notEqual(activeBg, 'rgba(0, 0, 0, 0)', 'selected token uses an active background');
  const other = picker.getByRole('option').nth(1);
  await other.hover();
  await page.waitForTimeout(200);
  assert.equal(await other.evaluate(element => getComputedStyle(element).backgroundColor), activeBg, 'active selection matches hover background');
  await selected.focus();
  await page.keyboard.press('End');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-posinset') === '179');
  await page.keyboard.press('Home');
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-posinset') === '1');
  await search.fill('T003');
  assert.equal(await picker.getByLabel('T003 wallet balance').innerText(), '—', 'failed token read stays unavailable');
  await search.fill('T004');
  assert.equal(await picker.getByLabel('T004 wallet balance').innerText(), '0.00', 'real zero is distinguishable');
  await search.fill('');
  // Opening and searching reuse fresh token entries, including duplicate market tokens.
  assert.equal(reads.filter(read => read.token === token(1) && read.owner === owner).length, 1);
  assert.equal(new Set(reads.filter(read => read.owner === owner).map(read => read.token)).size, 180);
  await fs.mkdir('/tmp/aave-wallet-balances', { recursive: true });
  await page.screenshot({ path: '/tmp/aave-wallet-balances/desktop.png' });
  await page.setViewportSize({ width: 390, height: 568 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await search.fill('WETH');
  await page.waitForTimeout(250);
  assert.equal(await picker.evaluate(element => element.scrollWidth > element.clientWidth), false, 'mobile picker fits');
  await page.screenshot({ path: '/tmp/aave-wallet-balances/mobile-dark.png' });
  await picker.getByRole('button', { name: 'Close token picker' }).click();
  const collateral = page.getByRole('textbox', { name: 'Collateral amount 1', exact: true });
  await collateral.fill('1.000000000000000001');
  assert.equal(await collateral.getAttribute('aria-invalid'), 'true', 'one wei above wallet balance is invalid');
  await collateral.fill('1');
  assert.notEqual(await collateral.getAttribute('aria-invalid'), 'true');
  wethBalance = 2n * 10n ** 18n;
  await page.waitForFunction(() => [...document.querySelectorAll('.amount-meta')].some(item => item.textContent.includes('Bal: 2.00')), null, { timeout: 20_000 });
  await page.evaluate(secondOwner => window.changeBalanceAccount(secondOwner), secondOwner);
  await page.waitForFunction(() => [...document.querySelectorAll('.amount-meta')].some(item => item.textContent.includes('Bal: 0.00')));
  await page.getByRole('button', { name: 'Select collateral asset', exact: true }).first().click();
  await search.fill('WETH');
  assert.equal(await picker.getByLabel('WETH wallet balance').innerText(), '0.00', 'wallet switch cannot reuse the previous wallet balance');
  assert.deepEqual(errors, []);
  console.log('PASS: multicall batching, shared cache, duplicate markets, funded sorting, 180-token virtualization, keyboard navigation, selection background, error/zero states, mobile layout, exact amounts, periodic refresh and wallet switching.');
})().catch(async error => { console.error(error, errors); const page = browser?.contexts()[0]?.pages()[0]; if (page) console.error(await page.evaluate(() => ({ text: document.body.innerText.slice(0, 1000), focus: document.activeElement?.outerHTML.slice(0, 300), rows: [...document.querySelectorAll('[data-index]')].map(row => row.getAttribute('aria-posinset')), scroll: document.querySelector('.picker-token-list')?.scrollTop }))); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

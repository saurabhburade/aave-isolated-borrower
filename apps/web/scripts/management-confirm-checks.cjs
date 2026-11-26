const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { decodeFunctionData, encodeFunctionResult, parseAbi, maxUint256 } = require('viem');
const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3210';
const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const weth = { id: 'weth', address: '0x' + '1'.repeat(40), symbol: 'WETH', name: 'Wrapped Ether', decimals: 18 };
const usdc = { ...weth, id: 'usdc', address: '0x' + '2'.repeat(40), symbol: 'USDC', name: 'USD Coin', decimals: 6 };
const fresh = { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: '123' };
const position = {
  id: 'position', chainId: 31337, owner, account: '0x' + '3'.repeat(40), salt: '0x' + '0'.repeat(64),
  market: { id: 'market', chainId: 31337, version: 3, venue: '0x' + '4'.repeat(40), name: 'Aave V3', network: 'Anvil', assets: [weth, usdc], status: 'available' },
  collaterals: [{ asset: weth, amount: '1', collateralEnabled: true }], debts: [],
  risk: { healthFactor: null, debtUsd: '0', collateralUsd: '1675.81', ltv: '0', borrowCapacityUsd: '1000' },
  freshness: fresh, activity: [], status: 'open',
};
let browser;
let receiptGate = Promise.resolve();
let receiptStatus = '0x0';
(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  await context.addInitScript(({ owner }) => {
    window.ethereum = {
      isMetaMask: true, on() {}, removeListener() {},
      async request({ method, params }) {
        if (method === 'eth_requestAccounts') { sessionStorage.setItem('connected', '1'); return [owner]; }
        if (method === 'eth_accounts') return sessionStorage.getItem('connected') ? [owner] : [];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'wallet_getCapabilities') return {};
        if (method === 'eth_sendTransaction') {
          window.signRequests = [...(window.signRequests || []), params[0]];
          if (window.revertNext) return '0x' + 'a'.repeat(64);
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
        }
        throw new Error('Unsupported test wallet method: ' + method);
      },
    };
  }, { owner });
  const page = await context.newPage();
  let managementRequests = 0;
  let portfolioRequests = 0;
  await page.route('**/api/positions?**', route => { portfolioRequests++; return route.fulfill({ json: { positions: [position], freshness: fresh } }); });
  await page.route('**/api/manage', async route => { managementRequests++; await route.fulfill({ status: 503, json: { error: 'Management backend must not be used.' } }); });
  await page.route('**/api/market-catalog?**', route => route.fulfill({ json: { markets: [{ ...position.market, chainId: 1, reserves: [weth, usdc].map(asset => ({ ...asset, canSupply: true, canBorrow: true, canCollateral: true, usdPrice: asset.id === 'weth' ? '1675.81' : '1', maxLtv: '0.75', liquidationThreshold: '0.8' })) }], errors: [] } }));
  const multicallAbi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
  const rpc = async route => {
    const payload = route.request().postDataJSON();
    const calls = Array.isArray(payload) ? payload : [payload];
    if (calls.some(call => call.method === 'eth_getTransactionReceipt')) await receiptGate;
    const results = calls.map(call => ({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_getTransactionReceipt'
      ? { transactionHash: call.params[0], blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x7b', transactionIndex: '0x0', from: owner, to: position.account, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '0'.repeat(512), status: receiptStatus, type: '0x2' }
      : call.method === 'eth_chainId' ? '0x7a69' : call.method === 'eth_blockNumber' ? '0x7b' : '0x' + maxUint256.toString(16) }));
    calls.forEach((call, index) => {
      if (call.method !== 'eth_call') return;
      const balanceResult = '0x' + (499000000n).toString(16).padStart(64, '0');
      if (call.params[0].data.startsWith('0x82ad56cb')) {
        const { args } = decodeFunctionData({ abi: multicallAbi, data: call.params[0].data });
        results[index].result = encodeFunctionResult({ abi: multicallAbi, functionName: 'aggregate3', result: args[0].map(() => ({ success: true, returnData: balanceResult })) });
      }
    });
    await route.fulfill({ json: Array.isArray(payload) ? results : results[0] });
  };
  await page.route('http://127.0.0.1:8557/**', rpc);
  await page.route('http://127.0.0.1:8557', rpc);
  await page.goto(base + '/31337/positions');
  await page.locator('.portfolio-empty').getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /MetaMask|Injected|Browser Wallet/i }).first().click();
  await page.getByRole('button', { name: /^Manage .* account/ }).first().click();
  const manage = page.getByRole('dialog', { name: 'Manage position', exact: true });
  await manage.getByRole('tab', { name: 'Remove collateral', exact: true }).click();
  await manage.getByRole('button', { name: 'Management asset', exact: true }).click();
  await page.getByRole('dialog', { name: 'Select collateral asset', exact: true }).getByRole('option').filter({ hasText: 'WETH' }).click();
  await manage.getByRole('button', { name: 'Max', exact: true }).click();
  const before = portfolioRequests;
  await manage.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => window.signRequests?.length === 1, null, { timeout: 3000 });
  const tx = await page.evaluate(() => window.signRequests[0]);
  const abi = parseAbi(['function execute((address token,uint256 amount)[] funding,(uint8 kind,address token,uint256 reserveId,uint256 amount,bool enabled)[] actions,(uint256 deadline,uint256 minHealthFactor,uint256 maxBorrowRateRay) limits)']);
  const decoded = decodeFunctionData({ abi, data: tx.data });
  assert.equal(tx.to.toLowerCase(), position.account);
  assert.deepEqual(decoded.args[0], []);
  assert.equal(decoded.args[1][0].kind, 1);
  assert.equal(decoded.args[1][0].amount, maxUint256);
  assert.equal(decoded.args[2].minHealthFactor, 1060000000000000000n);
  assert.equal(managementRequests, 0, 'Confirm must not call the management backend');
  assert.equal(portfolioRequests, before, 'Confirm must not reload the portfolio');
  await manage.getByText(/User rejected/).first().waitFor();
  let releaseReceipt;
  receiptGate = new Promise(resolve => { releaseReceipt = resolve; });
  await page.evaluate(() => { window.revertNext = true; });
  await manage.getByRole('button', { name: 'Confirm', exact: true }).click();
  const transaction = manage.locator('[data-step-id=position]');
  await transaction.getByText('Confirming', { exact: true }).first().waitFor();
  assert.equal(await manage.getByRole('button', { name: 'Confirm', exact: true }).isDisabled(), true);
  const hash = transaction.locator('a.execution-step-hash');
  assert.equal(await hash.innerText(), '0xaa…aa');
  assert.equal(await hash.locator('svg').count(), 0, 'hash uses an underline without an arrow');
  assert.match(await hash.getAttribute('href'), /\/tx\/0xa{64}$/);
  assert.equal(await hash.evaluate(element => getComputedStyle(element).textDecorationLine), 'underline');
  await manage.screenshot({ path: '/tmp/aave-confirming-compact.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await manage.evaluate(element => element.scrollWidth > element.clientWidth), false);
  await manage.screenshot({ path: '/tmp/aave-confirming-compact-mobile.png' });
  await page.setViewportSize({ width: 1280, height: 720 });
  releaseReceipt();
  await manage.getByRole('alert').getByText('The transaction reverted. Your position was not changed.', { exact: true }).waitFor();
  assert.equal(await manage.locator('[data-state=failed]').count(), 1);
  assert.equal(await manage.getByText('Status unknown', { exact: true }).count(), 0);
  assert.equal(await manage.getByText(/Confirmation is unavailable/).count(), 0);
  assert.equal(managementRequests, 0);
  await manage.locator('[data-slot=dialog-close]').click();
  position.debts = [{ asset: usdc, amount: '499.004545', collateralEnabled: false, apy: '0.05' }];
  position.risk = { ...position.risk, healthFactor: '3.45', debtUsd: '499', collateralUsd: '2095.04' };
  await page.getByRole('button', { name: 'Refresh portfolio' }).click();
  await page.locator('tbody tr').filter({ hasText: 'USDC' }).waitFor();
  await page.getByRole('button', { name: /^Manage .* account/ }).first().click();
  const beforeMax = portfolioRequests;
  await manage.getByRole('button', { name: 'Max', exact: true }).click();
  assert.equal(await manage.getByLabel('Management amount', { exact: true }).inputValue(), '499');
  const warning = manage.getByRole('status').filter({ hasText: /Not enough USDC/ });
  await warning.waitFor();
  assert.match(await warning.innerText(), /interest buffer.*499 USDC.*collateral will stay supplied/);
  assert.equal(await manage.locator('.review-scroll .review-notice').count(), 0, 'warnings appear below the metrics, in the status area');
  assert.equal(await manage.locator('.manage-impact-next').count(), 2, 'partial Max does not promise collateral withdrawal');
  assert.equal(portfolioRequests, beforeMax);
  assert.equal(managementRequests, 0);
  await manage.screenshot({ path: '/tmp/aave-max-repayment-warning.png' });
  await page.evaluate(() => { window.revertNext = false; });
  await manage.getByRole('button', { name: 'Confirm', exact: true }).click();
  await manage.getByText(/User rejected/).first().waitFor();
  const repaymentTx = await page.evaluate(() => window.signRequests.at(-1));
  const repayment = decodeFunctionData({ abi, data: repaymentTx.data });
  assert.equal(repayment.args[1].length, 1);
  assert.equal(repayment.args[1][0].kind, 3);
  assert.equal(repayment.args[1][0].amount, 499000000n);
  assert.equal(repayment.args[0][0].amount, 499000000n);
  assert.equal(managementRequests, 0);
  receiptStatus = '0x1';
  let releasePosition;
  const positionGate = new Promise(resolve => { releasePosition = resolve; });
  await page.route('**/api/positions/*?**', async route => {
    await positionGate;
    await route.fulfill({ json: { position } });
  });
  await page.evaluate(() => { window.revertNext = true; });
  await manage.getByRole('button', { name: 'Confirm', exact: true }).click();
  await transaction.getByText('Confirmed', { exact: true }).first().waitFor();
  assert.equal(await transaction.getAttribute('data-state'), 'done', 'successful receipt remains confirmed while position data loads');
  assert.equal(await manage.getByRole('button', { name: 'Confirm', exact: true }).isDisabled(), true);
  assert.equal(await manage.getByText('Updating position', { exact: true }).count(), 0);
  await manage.screenshot({ path: '/tmp/aave-confirmed-compact.png' });
  releasePosition();
  await transaction.getByText('Position updated.', { exact: true }).first().waitFor();
  console.log('PASS: direct confirmation, compact underlined hashes, stable Confirm button, mobile layout, confirming/confirmed states, known receipt failure, and balance-capped Max repayment.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

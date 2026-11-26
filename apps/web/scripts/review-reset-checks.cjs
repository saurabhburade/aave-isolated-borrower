const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { decodeFunctionData, encodeFunctionResult, parseAbi } = require('viem');

const base = process.env.APP_URL || 'http://127.0.0.1:3210';
const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const weth = { id: '31337/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'WETH', decimals: 18 };
const usdc = { id: '31337/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USDC', decimals: 6 };
const account = '0x0000000000000000000000000000000000001234';
const fresh = { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: '1' };
const risk = { healthFactor: '300', ltv: '0.01', borrowCapacityUsd: '2000', collateralUsd: '3000', debtUsd: '4' };
const market = { id: 'local-v3', chainId: 31337, version: 3, venue: account, name: 'Aave V3 Ethereum Pool', network: 'Anvil', assets: [weth, usdc], status: 'available' };
const catalog = { ...market, id: 'catalog-v3', chainId: 1, reserves: [weth, usdc].map(asset => ({ ...asset, usdPrice: asset.symbol === 'WETH' ? '3000' : '1', canSupply: true, canCollateral: true, canBorrow: true, maxLtv: '0.75', liquidationThreshold: '0.8' })) };
let browser;

(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ owner }) => {
    window.reviewTestSends = 0;
    window.ethereum = {
      isMetaMask: true, on() {}, removeListener() {},
      request: async ({ method, params = [] }) => {
        if (method === 'eth_requestAccounts') { sessionStorage.setItem('review-connected', '1'); return [owner]; }
        if (method === 'eth_accounts') return sessionStorage.getItem('review-connected') ? [owner] : [];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'wallet_getCapabilities') return {};
        if (method === 'eth_sendTransaction') {
          window.reviewTestSends++;
          return new Promise((resolve, reject) => {
            window.finishReviewWallet = () => resolve('0x' + 'a'.repeat(64));
            window.rejectReviewWallet = () => reject(Object.assign(new Error('User rejected request.'), { code: 4001 }));
          });
        }
        const body = await fetch('http://127.0.0.1:8557', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }).then(r => r.json());
        if (body.error) throw new Error(body.error.message);
        return body.result;
      },
    };
  }, { owner });
  // Wallet submissions and receipts are fixtures; this test never broadcasts.
  let receiptReads = 0;
  let releaseAllowance;
  let allowanceGate = new Promise(resolve => { releaseAllowance = resolve; });
  const multicallAbi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
  const tokenResult = async data => {
    if (data.startsWith('0xdd62ed3e')) { await allowanceGate; return '0x' + '0'.repeat(64); }
    return '0x' + (10000n * 10n ** 18n).toString(16).padStart(64, '0');
  };
  const rpc = async route => {
    const payload = route.request().postDataJSON();
    const calls = Array.isArray(payload) ? payload : [payload];
    const results = await Promise.all(calls.map(async call => {
      let result = call.method === 'eth_chainId' ? '0x7a69' : '0x1';
      if (call.method === 'eth_getTransactionReceipt') {
        receiptReads++;
        result = { transactionHash: call.params[0], blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x1', transactionIndex: '0x0', from: owner, to: weth.address, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '0'.repeat(512), status: '0x1', type: '0x2' };
      }
      if (call.method === 'eth_call') {
        const data = call.params[0].data;
        if (data.startsWith('0x82ad56cb')) {
          const { args } = decodeFunctionData({ abi: multicallAbi, data });
          const rows = await Promise.all(args[0].map(async item => ({ success: true, returnData: await tokenResult(item.callData) })));
          result = encodeFunctionResult({ abi: multicallAbi, functionName: 'aggregate3', result: rows });
        } else result = await tokenResult(data);
      }
      return { jsonrpc: '2.0', id: call.id, result };
    }));
    await route.fulfill({ json: Array.isArray(payload) ? results : results[0] });
  };
  await page.route('http://127.0.0.1:8557/**', rpc);
  await page.route('http://127.0.0.1:8557', rpc);
  await page.route('**/api/markets?**', route => route.fulfill({ json: { markets: [market], assets: [weth, usdc], freshness: fresh, creationDeployment: { factory: account, accountCreationCode: '0x6001' } } }));
  await page.route('**/api/market-catalog?**', route => route.fulfill({ json: { markets: [catalog], errors: [] } }));
  await page.route('**/api/market-rates?**', route => route.fulfill({ json: { rates: [{ marketId: catalog.id, borrowApy: '0.04', observedAt: fresh.observedAt }], errors: [] } }));
  await page.route('**/api/rate-history?**', route => route.fulfill({ json: { series: [], errors: [] } }));
  await page.route('**/api/quotes', route => route.fulfill({ json: { quotes: [{ marketId: market.id, eligible: true, executable: true, reasons: [], executionReasons: [], risk, borrowApr: '0.04', borrowApy: '0.04', freshness: fresh }], freshness: fresh } }));
  let prepareRequests = 0;
  await page.route('**/api/prepare', route => { prepareRequests++; return route.fulfill({ status: 503, json: { error: 'Backend preparation is disabled.' } }); });
  await page.goto(`${base}/31337`);
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /MetaMask|Injected|Browser Wallet/i }).first().click();
  await page.getByRole('textbox', { name: 'Collateral amount 1', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Debt amount', exact: true }).fill('4');
  const open = page.getByRole('button', { name: 'Review position', exact: true });
  const review = page.getByRole('dialog', { name: 'Review position' });
  await open.click();
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await review.locator('button[aria-busy=true]').waitFor();
  assert.equal(await review.getByRole('button', { name: 'Cancel', exact: true }).isEnabled(), true, 'pending allowance lookup must be dismissible');
  await page.keyboard.press('Escape');
  await review.waitFor({ state: 'hidden' });
  releaseAllowance();
  allowanceGate = Promise.resolve();
  await open.click();
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => window.reviewTestSends === 1);
  assert.equal(await review.getByRole('button', { name: 'Cancel', exact: true }).isEnabled(), true, 'pending wallet review must be dismissible');
  await review.getByRole('button', { name: 'Close', exact: true }).first().click();
  await review.waitFor({ state: 'hidden' });
  await open.click();
  await review.getByRole('button', { name: 'Confirm', exact: true }).waitFor();
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await review.getByRole('alert').filter({ hasText: /previous wallet request.*pending/i }).waitFor();
  assert.equal(await page.evaluate(() => window.reviewTestSends), 1, 'reopening must not duplicate a pending wallet request');
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await review.waitFor({ state: 'hidden' });
  await open.click();
  await review.getByRole('button', { name: 'Confirm', exact: true }).waitFor();
  await page.evaluate(() => window.finishReviewWallet());
  await assertEventually(() => receiptReads > 0, 'submitted approval receipt is still tracked');
  // Allow queued continuations and paints to settle after the receipt.
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.reviewTestSends), 1, 'dismissed flow must not request another signature');
  assert.equal(await review.locator('button[aria-busy=true]').count(), 0, 'old callbacks must not restore transaction status');
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => window.reviewTestSends === 2);
  await page.evaluate(() => window.rejectReviewWallet());
  await review.getByRole('alert').filter({ hasText: /reject/i }).waitFor();
  await review.getByRole('button', { name: 'Cancel', exact: true }).click();
  await review.waitFor({ state: 'hidden' });
  await open.click();
  await review.getByRole('button', { name: 'Confirm', exact: true }).waitFor();
  assert.equal(await review.getByRole('alert').count(), 0, 'reopening clears previous errors');
  assert.equal(prepareRequests, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: close during allowance lookup and wallet approval; fresh status on reopen; stale completion suppressed; approval receipt tracked; rejected request cleared. No transactions broadcast.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

async function assertEventually(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.fail(message);
}

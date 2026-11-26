const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { concatHex, decodeFunctionData, encodeAbiParameters, encodeFunctionResult, getContractAddress, keccak256, maxUint256, parseAbi, parseAbiParameters } = require('viem');
const base = process.env.APP_URL || 'http://127.0.0.1:3210';
const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const key = `aave-position:intent:31337:${owner}`;
const consumed = '0x' + 'ab'.repeat(32);
const weth = { id: '31337/0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', address: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', symbol: 'WETH', name: 'WETH', decimals: 18 };
const usdc = { id: '31337/0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', address: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', symbol: 'USDC', name: 'USDC', decimals: 6 };
const venue = '0x0000000000000000000000000000000000001234';
const deployment = { factory: '0x0000000000000000000000000000000000005678', accountCreationCode: '0x6001' };
const nativeBorrowRate = 46020948791512481612045926n;
const fresh = { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: '1' };
const market = { id: 'local-v3', chainId: 31337, version: 3, venue, name: 'Aave V3 Ethereum Pool', network: 'Anvil', assets: [weth, usdc], status: 'available' };
const catalog = { ...market, id: 'catalog-v3', chainId: 1, reserves: [weth, usdc].map(asset => ({ ...asset, usdPrice: asset.symbol === 'WETH' ? '1700' : '1', canSupply: true, canCollateral: true, canBorrow: true, maxLtv: '0.81', liquidationThreshold: '0.84' })) };
const factoryAbi = parseAbi(['function createPosition(uint8 version,address venue,bytes32 salt,(address token,uint256 amount)[] funding,(uint8 kind,address token,uint256 reserveId,uint256 amount,bool enabled)[] actions,(uint256 deadline,uint256 minHealthFactor,uint256 maxBorrowRateRay) limits) returns (address)']);
const multicallAbi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
const accounts = new Set();
function accountFor(salt) {
  const deploymentSalt = keccak256(encodeAbiParameters(parseAbiParameters('uint256,address,uint8,address,bytes32'), [31337n, owner, 3, venue, salt]));
  const constructor = encodeAbiParameters(parseAbiParameters('address,uint8,address,bytes32'), [owner, 3, venue, salt]);
  return getContractAddress({ opcode: 'CREATE2', from: deployment.factory, salt: deploymentSalt, bytecode: concatHex([deployment.accountCreationCode, constructor]) });
}
let browser;
let page;
(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(({ owner, key, consumed }) => {
    if (!sessionStorage.getItem(key)) sessionStorage.setItem(key, consumed);
    window.intentTestSends = 0;
    window.intentTransactions = [];
    window.ethereum = { isMetaMask: true, on() {}, removeListener() {}, async request({ method, params = [] }) {
      if (method === 'eth_requestAccounts') { sessionStorage.setItem('intent-connected', '1'); return [owner]; }
      if (method === 'eth_accounts') return sessionStorage.getItem('intent-connected') ? [owner] : [];
      if (method === 'eth_chainId') return '0x7a69';
      if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
      if (method === 'wallet_getCapabilities') return {};
      if (method === 'eth_sendTransaction') {
        const send = ++window.intentTestSends;
        window.intentTransactions.push(params[0]);
        return new Promise((resolve, reject) => {
          window.finishIntentWallet = () => resolve('0x' + String(send).padStart(64, '0'));
          window.rejectIntentWallet = () => reject(Object.assign(new Error('User rejected request.'), { code: 4001 }));
        });
      }
      throw new Error('Unsupported mocked wallet method: ' + method);
    } };
  }, { owner, key, consumed });
  let prepareRequests = 0;
  let quoteRequests = 0;
  let marketRequests = 0;
  let preflightCalls = 0;
  let bytecodeReads = 0;
  let positionReads = 0;
  const rpc = async route => {
    const payload = route.request().postDataJSON();
    const calls = Array.isArray(payload) ? payload : [payload];
    const results = calls.map(call => {
      let result = '0x1';
      if (call.method === 'eth_chainId') result = '0x7a69';
      if (call.method === 'eth_getCode') { bytecodeReads++; result = '0x'; }
      if (call.method === 'eth_getTransactionReceipt') result = { transactionHash: call.params[0], blockHash: '0x' + 'b'.repeat(64), blockNumber: '0x1', transactionIndex: '0x0', from: owner, to: deployment.factory, cumulativeGasUsed: '0x5208', gasUsed: '0x5208', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: '0x' + '0'.repeat(512), status: BigInt(call.params[0]) === 3n ? '0x0' : '0x1', type: '0x2' };
      if (call.method === 'eth_call') {
        const target = call.params[0].to?.toLowerCase();
        if ([venue.toLowerCase(), deployment.factory].includes(target)) preflightCalls++;
        const value = data => '0x' + (data.startsWith('0x70a08231') ? 999n * 10n ** 18n : maxUint256).toString(16).padStart(64, '0');
        result = value(call.params[0].data);
        if (call.params[0].data.startsWith('0x82ad56cb')) {
          const { args } = decodeFunctionData({ abi: multicallAbi, data: call.params[0].data });
          result = encodeFunctionResult({ abi: multicallAbi, functionName: 'aggregate3', result: args[0].map(item => ({ success: true, returnData: value(item.callData) })) });
        }
      }
      return { jsonrpc: '2.0', id: call.id, result };
    });
    await route.fulfill({ json: Array.isArray(payload) ? results : results[0] });
  };
  await page.route('http://127.0.0.1:8557/**', rpc);
  await page.route('http://127.0.0.1:8557', rpc);
  await page.route('**/api/markets?**', route => { marketRequests++; return route.fulfill({ json: { markets: [market], assets: [weth, usdc], freshness: fresh, creationDeployment: deployment } }); });
  await page.route('**/api/market-catalog?**', route => route.fulfill({ json: { markets: [catalog], errors: [] } }));
  await page.route('**/api/market-rates?**', route => route.fulfill({ json: { rates: [{ marketId: catalog.id, borrowApy: Math.expm1(Number(nativeBorrowRate) / 1e27).toString(), borrowRateRay: nativeBorrowRate.toString(), observedAt: fresh.observedAt }], errors: [] } }));
  await page.route('**/api/rate-history?**', route => route.fulfill({ json: { series: [], errors: [] } }));
  await page.route('**/api/quotes', route => { quoteRequests++; return route.fulfill({ status: 503, json: { error: 'Quotes must not be requested.' } }); });
  await page.route('**/api/prepare', route => { prepareRequests++; return route.fulfill({ status: 503, json: { error: 'Preparation backend must not be requested.' } }); });
  await page.route('**/api/positions/0x*', route => {
    positionReads++;
    return route.fulfill({ status: 503, json: { error: 'Position data is unavailable.' } });
  });
  await page.goto(`${base}/31337`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.getByRole('button', { name: 'Select debt asset', exact: true }).getByText('USDC', { exact: true }).waitFor();
  await page.locator('button.borrow-primary').click();
  await page.getByRole('dialog').getByRole('button', { name: /MetaMask|Injected|Browser Wallet/i }).first().click();
  await page.getByRole('textbox', { name: 'Collateral amount 1', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Debt amount', exact: true }).fill('2');
  const open = page.getByRole('button', { name: 'Review position', exact: true });
  const review = page.getByRole('dialog', { name: 'Review position' });
  await open.click();
  const approve = review.getByRole('button', { name: 'Confirm', exact: true });
  await approve.waitFor();
  const initial = await page.evaluate(key => sessionStorage.getItem(key), key);
  assert.notEqual(initial, consumed, 'a new review retires a potentially consumed saved salt without a chain read');
  const beforeMarkets = marketRequests;
  await approve.click();
  await page.waitForFunction(() => window.intentTestSends === 1, null, { timeout: 3000 });
  assert.equal(marketRequests, beforeMarkets, 'Confirm reuses the loaded market');
  assert.equal(prepareRequests, 0);
  assert.equal(quoteRequests, 0);
  const tx = await page.evaluate(() => window.intentTransactions[0]);
  assert.equal(tx.to.toLowerCase(), deployment.factory);
  const decoded = decodeFunctionData({ abi: factoryAbi, data: tx.data });
  assert.equal(decoded.args[2], initial);
  assert.equal(decoded.args[5].maxBorrowRateRay, nativeBorrowRate + nativeBorrowRate / 20n + 1n, 'signing uses the same fork rate loaded in the market table');
  assert.deepEqual(decoded.args[4].map(action => action.kind), [0, 4, 2]);
  accounts.add(accountFor(initial).toLowerCase());
  await review.getByRole('region', { name: 'Position transaction progress' }).waitFor();
  await page.evaluate(() => window.rejectIntentWallet());
  await review.getByRole('alert').filter({ hasText: /reject/i }).waitFor();
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), initial, 'wallet rejection preserves the reviewed account');
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => window.intentTestSends === 2);
  await page.evaluate(() => window.finishIntentWallet());
  await review.locator('.morphing-text-content').filter({ hasText: /^Position created\.$/ }).waitFor({ timeout: 3000 });
  await review.locator('.morphing-text-content').filter({ hasText: /^Completed$/ }).waitFor();
  assert.equal(await review.locator('.execution-step-hash').getAttribute('href'), `https://etherscan.io/tx/0x${'2'.padStart(64, '0')}`);
  assert.equal(positionReads, 0, 'successful creation must not fetch position state');
  await review.getByRole('link', { name: 'View positions', exact: true }).waitFor();
  await page.waitForFunction(({ key, initial }) => sessionStorage.getItem(key) !== initial, { key, initial });
  await review.locator('[data-slot=dialog-close]').click();
  await open.click();
  const second = await page.evaluate(key => sessionStorage.getItem(key), key);
  assert.notEqual(second, initial);
  assert(!accounts.has(accountFor(second).toLowerCase()));
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => window.intentTestSends === 3);
  await page.evaluate(() => window.finishIntentWallet());
  await review.getByRole('alert').getByText(/The transaction reverted/).waitFor();
  assert.equal(await review.getByText('Status unknown', { exact: true }).count(), 0);
  assert.equal(await page.evaluate(key => sessionStorage.getItem(key), key), second, 'reverted receipts preserve their intent');
  await review.locator('[data-slot=dialog-close]').click();
  await open.click();
  const third = await page.evaluate(key => sessionStorage.getItem(key), key);
  await review.getByRole('button', { name: 'Confirm', exact: true }).click();
  await page.waitForFunction(() => window.intentTestSends === 4);
  await review.locator('[data-slot=dialog-close]').click();
  await page.evaluate(() => window.finishIntentWallet());
  await page.waitForFunction(({ key, third }) => sessionStorage.getItem(key) !== third, { key, third });
  assert.equal(prepareRequests, 0);
  assert.equal(quoteRequests, 0);
  assert.equal(preflightCalls, 0);
  assert.equal(bytecodeReads, 0);
  assert.equal(positionReads, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: creation shows success and transaction hash from the receipt without position API reads; rejection, revert, unique accounts, and dismissed receipt tracking work. No transactions broadcast.');
})().catch(async error => { console.error(error); console.error(await page?.locator('body').innerText().catch(() => 'Page unavailable')); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

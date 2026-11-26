const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:3210';
const artifacts = process.env.BROWSER_ARTIFACTS || '/tmp/aave-browser-checks';
const transact = process.env.RUN_LOCAL_WALLET_UI === '1';
let browser;
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  if (transact) {
    const rpc = await fetch('http://127.0.0.1:8557', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) }).then(r => r.json());
    assert.equal(rpc.result, '0x7a69', 'wallet tests require the disposable local fork');
    await context.addInitScript(() => {
      const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
      const listeners = new Map();
      const provider = {
        isMetaMask: true,
        on: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
        removeListener: (event, callback) => listeners.get(event)?.delete(callback),
        request: async ({ method, params = [] }) => {
          if (method === 'eth_requestAccounts' || method === 'wallet_requestPermissions') {
            sessionStorage.setItem('local-test-wallet-authorized', '1');
            return method === 'eth_requestAccounts' ? [owner] : [{ parentCapability: 'eth_accounts' }];
          }
          if (method === 'eth_chainId' && window.localTestChain) return window.localTestChain;
          if (method === 'eth_accounts') return sessionStorage.getItem('local-test-wallet-authorized') ? [owner] : [];
          if (method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
          if (method === 'wallet_getCapabilities') return {};
          if (method === 'wallet_switchEthereumChain' || method === 'wallet_addEthereumChain') {
            if (params[0]?.chainId !== '0x7a69') throw Object.assign(new Error('Only local fork supported in tests.'), { code: 4902 });
            return null;
          }
          if (method === 'eth_sendTransaction' && window.localTestReject) throw Object.assign(new Error('User rejected the local test signature.'), { code: 4001 });
          const response = await fetch('http://127.0.0.1:8557', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }) }).then(r => r.json());
          if (response.error) throw Object.assign(new Error(response.error.message), { code: response.error.code, data: response.error.data });
          return response.result;
        },
      };
      window.ethereum = provider;
    });
  }
  const page = await context.newPage();
  const errors = [];
  let prepareRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/api/prepare') prepareRequests++; });
  page.on('pageerror', error => { errors.push(error.message); console.error('Browser error:', error.message); });
  await page.goto(`${base}/31337`, { waitUntil: 'load' });
  await page.getByRole('heading', { name: 'Create an isolated position' }).waitFor();
  await page.waitForFunction(() => {
    const toggle = document.querySelector('[aria-label="Toggle dark mode"]');
    return toggle && Object.keys(toggle).some(key => key.startsWith('__reactProps'));
  });
  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  await page.locator('.history-plot, .history-empty').first().waitFor({ timeout: 60000 });
  assert(await page.locator('html').evaluate(element => element.classList.contains('dark')));
  const columns = await page.evaluate(() => ({ left: document.querySelector('.borrow-column').getBoundingClientRect().x, right: document.querySelector('.quote-column').getBoundingClientRect().x, width: document.querySelector('.borrow-column').getBoundingClientRect().width }));
  assert(columns.left < columns.right, 'layout keeps borrow form on the left and chart on the right');
  assert(Math.abs(columns.width - 400) < 2, 'reference borrow column is 400px');
  if (await page.locator('.history-plot').count()) {
    await page.locator('.history-plot').focus();
    await page.keyboard.press('ArrowRight');
    await page.locator('.history-readout').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.history-readout').waitFor({ state: 'hidden' });
    const oneDay = page.waitForResponse(response => response.url().includes('/api/rate-history') && response.url().includes('window=1d') && response.status() === 200);
    await page.getByRole('button', { name: '1D', exact: true }).click();
    assert.equal((await oneDay).status(), 200);
    await page.locator('.history-plot').waitFor();
    const sevenDays = page.waitForResponse(response => response.url().includes('/api/rate-history') && response.url().includes('window=7d') && response.status() === 200);
    await page.getByRole('button', { name: '7D', exact: true }).click();
    assert.equal((await sevenDays).status(), 200);
    await page.locator('.history-plot').waitFor();
  }
  await page.getByRole('button', { name: 'Select network, Anvil', exact: true }).click();
  await page.getByRole('menuitem').first().waitFor();
  assert.equal(await page.getByRole('menuitem').count(), 1, 'only verified local chain is offered');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Borrow settings', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'Borrow settings' });
  await settings.getByText('1.20', { exact: true }).waitFor();
  await page.waitForFunction(() => {
    const dialog = document.querySelector('[role=dialog]');
    if (!dialog) return false;
    const box = dialog.getBoundingClientRect();
    return Math.abs(box.x + box.width / 2 - innerWidth / 2) < 2
      && Math.abs(box.y + box.height / 2 - innerHeight / 2) < 2;
  });
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await page.getByRole('textbox', { name: 'Collateral amount 2', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Remove collateral 2', exact: true }).click();

  await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifacts, 'desktop-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  if (transact) {
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
    const dialog = page.getByRole('dialog');
    console.log('Browser wallet chooser available.');
    const choices = dialog.getByRole('button', { name: /MetaMask|Injected|Browser Wallet/i });
    await choices.first().click();
    await page.getByRole('button', { name: /0xf39f/i }).waitFor({ timeout: 30000 });
    await page.getByRole('textbox', { name: 'Collateral amount 1', exact: true }).waitFor({ timeout: 240000 });
    const selectionInventory = await page.request.get(`${base}/api/markets?chainId=31337`).then(r => r.json());
    const v4Market = selectionInventory.markets.find(m => m.version === 4);
    const catalog = selectionInventory.assets;
    const wethIndex = catalog.filter(a => `${a.symbol} ${a.name} ${a.address}`.toLowerCase().includes('weth')).findIndex(a => a.tokenId === v4Market.assets.find(asset => asset.symbol === 'WETH').tokenId);
    const usdcIndex = catalog.filter(a => `${a.symbol} ${a.name} ${a.address}`.toLowerCase().includes('usdc')).findIndex(a => a.tokenId === v4Market.assets.find(asset => asset.symbol === 'USDC').tokenId);
    assert(wethIndex >= 0 && usdcIndex >= 0, 'V4 reserves are present in the picker');
    await page.getByRole('button', { name: 'Select collateral asset', exact: true }).first().click();
    const picker = page.getByRole('dialog', { name: 'Select collateral asset 1' });
    await picker.getByLabel('Search tokens or paste address').fill('WETH');
    await picker.getByRole('option').nth(wethIndex).click();
    await page.getByRole('button', { name: 'Select debt asset', exact: true }).click();
    const debtPicker = page.getByRole('dialog', { name: 'Select debt asset', exact: true });
    await debtPicker.getByLabel('Search tokens or paste address').fill('USDC');
    await debtPicker.getByRole('option').nth(usdcIndex).click();
    await page.getByRole('textbox', { name: 'Collateral amount 1', exact: true }).fill('0.1');
    await page.getByRole('textbox', { name: 'Debt amount', exact: true }).fill('5');
    const market = page.getByRole('button', { name: /Aave V4 Ethereum Main Spoke/ });
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === 'Aave V4 Ethereum Main Spoke' && !button.disabled), null, { timeout: 120000 });
    await market.click();
    console.log('Selected native V4 quote.');
    await page.getByRole('button', { name: 'V4', exact: true }).click();
    await page.getByRole('button', { name: 'All', exact: true }).click();
    assert.equal(await market.getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifacts, 'desktop-light-funded.png'), fullPage: true });
    const preparesBeforeReview = prepareRequests;
    await page.getByRole('button', { name: 'Review position', exact: true }).click();
    const review = page.getByRole('dialog', { name: 'Review position' });
    await review.getByText('Borrowing', { exact: true }).waitFor();
    assert.equal(await review.getByRole('button', { name: 'Refresh & simulate', exact: true }).count(), 0, 'review opens directly from market estimates');
    await page.waitForFunction(() => [...document.querySelectorAll('[role=dialog] button')].some(button => button.textContent === 'Confirm' && !button.disabled), null, { timeout: 120000 });
    assert.equal(prepareRequests, preparesBeforeReview, 'opening review must not prepare or simulate');
    await page.waitForFunction(() => {
      const overlay = document.querySelector('[data-slot=dialog-overlay]');
      return overlay && Number(getComputedStyle(overlay).opacity) === 1;
    });
    const reviewBackdrop = page.locator('[data-slot=dialog-overlay]');
    assert.equal(await reviewBackdrop.count(), 1, 'review has its own backdrop while settings is closed');
    assert.notEqual(await reviewBackdrop.evaluate(el => getComputedStyle(el).backdropFilter), 'none', 'review backdrop blurs background');
    console.log('Native review ready with visible backdrop.');
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifacts, 'review.png'), fullPage: true });
    await page.evaluate(() => { window.localTestChain = '0x1'; });
    await review.getByRole('button', { name: 'Confirm', exact: true }).click();
    await review.getByRole('alert').filter({ hasText: /network changed/i }).waitFor({ timeout: 30000 });
    await page.evaluate(() => { window.localTestChain = undefined; window.localTestReject = true; });
    await review.getByRole('button', { name: 'Confirm', exact: true }).click();
    await review.getByRole('alert').filter({ hasText: /reject/i }).waitFor({ timeout: 30000 });
    console.log('Rejected signature preserved the creation intent.');
    await page.evaluate(() => { window.localTestReject = false; });
    await review.getByRole('button', { name: 'Confirm', exact: true }).click();
    await review.locator('.execution-step-name .morphing-text-content').filter({ hasText: 'Position created.' }).waitFor({ timeout: 120000 });
    console.log('Native position creation confirmed.');
    await review.getByRole('link', { name: 'View positions' }).click();
    await page.getByRole('table').waitFor({ timeout: 120000 });
    const positionRow = page.locator('tbody tr').filter({ hasText: 'Aave V4' }).first();
    await positionRow.getByRole('button', { name: /^Manage .* account/ }).click();
    const manage = page.getByRole('dialog', { name: 'Manage position' });
    const inventory = await page.request.get(`${base}/api/markets`).then(r => r.json());
    const wsteth = inventory.markets.find(m => m.version === 4).assets.find(a => a.symbol.toLowerCase() === 'wsteth');
    await manage.getByRole('tab', { name: 'Add collateral', exact: true }).click();
    await manage.getByRole('button', { name: 'Management asset', exact: true }).click();
    const managementPicker = page.getByRole('dialog', { name: 'Select collateral asset', exact: true });
    await managementPicker.getByRole('option').filter({ hasText: wsteth.symbol }).first().click();
    await managementPicker.waitFor({ state: 'hidden' });
    await manage.getByLabel('Management amount', { exact: true }).fill('0.1');
    await manage.getByRole('button', { name: 'Confirm', exact: true }).waitFor({ timeout: 120000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifacts, 'management-review-light.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.add('dark'));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert(await manage.evaluate(element => element.scrollWidth <= innerWidth), 'mobile management dialog fits the viewport');
    await page.screenshot({ path: path.join(artifacts, 'management-review-mobile-dark.png'), fullPage: true });
    await page.evaluate(() => document.documentElement.classList.remove('dark'));
    await page.setViewportSize({ width: 1440, height: 1000 });
    await manage.getByRole('button', { name: 'Confirm', exact: true }).click();
    await manage.locator('.execution-step-name .morphing-text-content').filter({ hasText: 'Position updated.' }).waitFor({ timeout: 120000 });
    await manage.locator('.review-footer').getByRole('button', { name: 'Close', exact: true }).click();
    await manage.waitFor({ state: 'hidden', timeout: 120000 });
    await positionRow.getByText(/wstETH/).waitFor({ timeout: 120000 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifacts, 'position-management.png'), fullPage: true });
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(250);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile positions page has no horizontal overflow');
    await page.screenshot({ path: path.join(artifacts, 'position-mobile-dark.png'), fullPage: true });
    await page.getByRole('button', { name: 'Toggle dark mode' }).click();
    console.log('Native UI create and same-account second collateral:', page.url());
  }
  await page.goto(`${base}/31337/about`);
  await page.getByRole('heading', { name: 'Aave V4: liquidity vs risk' }).waitFor();
  await page.keyboard.press('Tab');
  assert(await page.evaluate(() => document.activeElement !== document.body), 'keyboard navigation can reach controls');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${base}/31337`);
  await page.getByRole('heading', { name: 'Create an isolated position' }).waitFor();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, 'mobile page has no horizontal overflow');
  await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifacts, 'mobile-light.png'), fullPage: true });
  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(artifacts, 'mobile-dark.png'), fullPage: true });
  assert.deepEqual(errors, [], 'no browser page errors');
  console.log(JSON.stringify({ status: 'PASS', transact, errors, artifacts }));
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

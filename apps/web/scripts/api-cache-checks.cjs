const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.APP_URL || 'http://127.0.0.1:3210';
const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const reserve = (address, symbol) => ({ address, symbol, name: symbol, decimals: 18, usdPrice: '1', canBorrow: true, canSupply: true, canCollateral: true });
const markets = [{ id: 'core', version: 3, venue: '0x' + '1'.repeat(40), name: 'Aave V3 Core', chainId: 1, network: 'Ethereum', isTestnet: false, reserves: [reserve(weth, 'WETH'), reserve(usdc, 'USDC')] }];
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(15_000);
  const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
  await page.addInitScript(({ owner }) => {
    let account = owner;
    let connected = false;
    const listeners = new Map();
    window.ethereum = {
      isMetaMask: true,
      on: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
      removeListener: (event, callback) => listeners.get(event)?.delete(callback),
      request: async ({ method }) => {
        if (method === 'eth_requestAccounts') { connected = true; return [account]; }
        if (method === 'eth_accounts') return connected ? [account] : [];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'wallet_getCapabilities') return {};
        throw new Error('Unsupported test wallet method: ' + method);
      },
    };
    window.switchCacheTestOwner = address => { account = address; listeners.get('accountsChanged')?.forEach(callback => callback([address])); };
  }, { owner });
  const errors = [];
  const requests = { markets: 0, catalog: 0, rates: 0, history: 0 };
  let delay = 0;
  let fail = false;
  page.on('pageerror', error => errors.push(error.message));
  const respond = async (route, key, json) => {
    requests[key]++;
    await new Promise(resolve => setTimeout(resolve, delay));
    await route.fulfill(fail ? { status: 503, json: { error: 'Temporarily unavailable' } } : { json });
  };
  await page.route('**/api/markets?**', route => respond(route, 'markets', { markets: [], assets: [], freshness: { status: 'fresh' } }));
  await page.route('**/api/market-catalog?**', route => respond(route, 'catalog', { markets, errors: [] }));
  await page.route('**/api/market-rates?**', route => respond(route, 'rates', { rates: [{ marketId: 'core', borrowApy: '0.04', observedAt: new Date().toISOString() }], errors: [] }));
  await page.route(/\/api\/rate-history\/?\?/, route => {
    const url = new URL(route.request().url());
    const now = Math.floor(Date.now() / 1000);
    return respond(route, 'history', { chainId: Number(url.searchParams.get('chainId')), sourceChainId: 1, debtAddress: usdc, from: now - 86400, to: now, fetchedAt: now, series: [{ id: 'core', label: 'Aave V3 Core', detail: 'Core', points: [{ timestamp: now - 86400, apy: 0.03 }, { timestamp: now, apy: 0.04 }] }] });
  });
  let positionsDelay = 0;
  let emptyPositions = false;
  const positionsRequests = [];
  const freshness = { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: '123' };
  const asset = (address, symbol) => ({ id: symbol, address, symbol, name: symbol, decimals: 18 });
  const position = {
    id: 'position-1', chainId: 31337, account: '0x' + '3'.repeat(40), owner, salt: '0x' + '0'.repeat(64),
    market: { id: 'core', chainId: 31337, version: 3, venue: markets[0].venue, name: 'Ethereum Core', network: 'Anvil', assets: [asset(weth, 'WETH'), asset(usdc, 'USDC')], status: 'available' },
    collaterals: [{ asset: asset(weth, 'WETH'), amount: '2', collateralEnabled: true }],
    debts: [{ asset: asset(usdc, 'USDC'), amount: '100', collateralEnabled: false, apy: '0.04' }],
    risk: { healthFactor: '2', debtUsd: '100', collateralUsd: '1000', ltv: '0.1', borrowCapacityUsd: '600' },
    freshness, activity: [], status: 'open',
  };
  await page.route('**/api/positions?**', async route => {
    const requestedOwner = new URL(route.request().url()).searchParams.get('owner');
    positionsRequests.push(requestedOwner);
    await new Promise(resolve => setTimeout(resolve, positionsDelay));
    await route.fulfill({ json: { positions: requestedOwner.toLowerCase() === owner && !emptyPositions ? [position] : [], freshness } });
  });
  const nav = page.getByRole('navigation', { name: 'Primary navigation' });
  await page.goto(`${base}/31337`);
  await page.locator('.platform-table').getByText('4.00%', { exact: true }).waitFor();
  await page.getByRole('group', { name: /USDC borrow APY history/ }).waitFor();
  const before = { ...requests };
  delay = 1000;
  await nav.getByRole('link', { name: 'About', exact: true }).click();
  await page.waitForURL('**/about');
  // Record transient loading states too, rather than only inspecting settled DOM.
  await page.evaluate(() => {
    window.cacheSkeletons = [];
    new MutationObserver(() => {
      for (const element of document.querySelectorAll('[aria-label="Loading market"], [aria-label="Loading borrow APY"], .history-chart-stage[data-loading="true"]')) window.cacheSkeletons.push(element.outerHTML);
    }).observe(document.body, { childList: true, subtree: true, attributes: true });
  });
  await nav.getByRole('link', { name: 'Borrow', exact: true }).click();
  await page.waitForURL('**/31337');
  await page.getByRole('group', { name: /USDC borrow APY history/ }).waitFor();
  assert.deepEqual(await page.evaluate(() => window.cacheSkeletons), [], 'returning to Borrow must never replace cached markets, rates, or history with skeletons');
  assert.deepEqual(requests, before, 'fresh cached responses avoid duplicate requests after navigation');
  const refreshed = { ...requests };
  await page.getByRole('button', { name: 'Refresh markets', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('button[aria-label="Refresh markets"]')?.disabled === false);
  assert(requests.catalog > refreshed.catalog && requests.rates > refreshed.rates && requests.markets > refreshed.markets, 'manual refresh bypasses the cache');
  assert.deepEqual(await page.evaluate(() => window.cacheSkeletons), [], 'refresh keeps cached content visible');
  fail = true;
  await page.getByRole('button', { name: 'Refresh markets', exact: true }).click();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('.platform-table').getByText('4.00%', { exact: true }).count(), 1, 'failed background refresh retains the last response');
  fail = false;
  await nav.getByRole('link', { name: 'Positions', exact: true }).click();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).last().click();
  await page.getByRole('dialog').getByRole('button', { name: /MetaMask|Injected|Browser Wallet/i }).first().click();
  await page.getByText('1–1 of 1 positions', { exact: true }).waitFor();
  positionsDelay = 1500;
  await nav.getByRole('link', { name: 'About', exact: true }).click();
  await page.waitForURL('**/about');
  await page.evaluate(() => { window.cachePositionSkeletons = 0; new MutationObserver(() => {
    if (document.querySelector('[aria-label="Loading positions"], .portfolio-overview [data-slot="skeleton"]')) window.cachePositionSkeletons++;
  }).observe(document.body, { childList: true, subtree: true, attributes: true }); });
  const beforePositions = positionsRequests.length;
  await nav.getByRole('link', { name: 'Positions', exact: true }).click();
  await page.getByText('1–1 of 1 positions', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.portfolio-overview')?.getAttribute('aria-busy') === 'false');
  assert(positionsRequests.length > beforePositions, 'positions revalidate on returning to the page');
  assert.equal(await page.evaluate(() => window.cachePositionSkeletons), 0, 'cached positions remain visible during revalidation');
  await page.evaluate(() => window.switchCacheTestOwner('0x' + '9'.repeat(40)));
  await page.getByRole('status', { name: 'Loading positions', exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').filter({ hasText: 'USDC' }).count(), 0, 'a different wallet never sees the previous owner’s cached positions');
  await page.getByText('No open positions yet.', { exact: true }).waitFor();
  emptyPositions = true;
  await page.evaluate(({ owner }) => window.switchCacheTestOwner(owner), { owner });
  await page.getByText('1–1 of 1 positions', { exact: true }).waitFor();
  await page.getByText('No open positions yet.', { exact: true }).waitFor();
  await page.evaluate(() => { window.cachePositionSkeletons = 0; });
  await nav.getByRole('link', { name: 'About', exact: true }).click();
  await page.waitForURL('**/about');
  await nav.getByRole('link', { name: 'Positions', exact: true }).click();
  await page.getByText('No open positions yet.', { exact: true }).waitFor();
  await page.waitForFunction(() => document.querySelector('.portfolio-overview')?.getAttribute('aria-busy') === 'false');
  assert.equal(await page.evaluate(() => window.cachePositionSkeletons), 0, 'a cached empty portfolio does not return to skeletons');
  assert.deepEqual(errors, []);
  console.log('Passed: navigation reuses API responses without transient skeletons, manual refresh fetches new data, and refresh failure retains cached content, positions revalidate without skeletons (including empty results), and wallet caches stay isolated.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

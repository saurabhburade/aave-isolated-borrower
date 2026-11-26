const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const base = process.env.APP_URL || 'http://127.0.0.1:3210';
const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
const weth = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2';
const dai = '0x6B175474E89094C44Da98b954EedeAC495271d0F';
const reserve = (address, symbol) => ({ address, symbol, name: symbol, decimals: 18, canBorrow: true, canSupply: true, canCollateral: true });
const markets = [
  { id: 'core', name: 'Aave V3 Core', version: 3, reserves: [reserve(weth, 'WETH'), reserve(usdc, 'USDC'), reserve(dai, 'DAI')] },
  { id: 'prime', name: 'Aave V3 Prime', version: 3, reserves: [reserve(weth, 'WETH'), reserve(usdc, 'USDC')] },
  { id: 'main', name: 'Aave V4 Main', version: 4, reserves: [reserve(weth, 'WETH'), reserve(usdc, 'USDC')] },
  { id: 'dai', name: 'Aave V4 DAI', version: 4, reserves: [reserve(dai, 'DAI'), reserve(usdc, 'USDC')] },
].map((market, index) => ({ ...market, venue: `0x${String(index + 1).padStart(40, '0')}`, chainId: 1, network: 'Ethereum', isTestnet: false }));
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: 'reduce' });
  const errors = [];
  const requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/markets?**', route => route.fulfill({ json: { markets: [], assets: [], freshness: { status: 'unavailable' } } }));
  await page.route('**/api/market-catalog?**', route => route.fulfill({ json: { markets, errors: [] } }));
  await page.route('**/api/market-rates?**', route => {
    const ids = JSON.parse(new URL(route.request().url()).searchParams.get('marketIds'));
    return route.fulfill({ json: { rates: ids.map(marketId => ({ marketId, borrowApy: '0.04', observedAt: new Date().toISOString() })), errors: [] } });
  });
  // Match both the canonical path and the client's slash redirect.
  await page.route(/\/api\/rate-history\/?\?/, route => {
    const url = new URL(route.request().url());
    const ids = JSON.parse(url.searchParams.get('marketIds'));
    const window = url.searchParams.get('window');
    const debtAddress = url.searchParams.get('debtAddress');
    requests.push({ ids, window, debtAddress });
    const now = Math.floor(Date.now() / 1000);
    const series = ids.map((id, index) => ({ id, label: markets.find(market => market.id === id).name, venue: id, source: 'test', detail: id,
      points: id === 'prime' && window === '1d' ? [] : [2, 1, 0].map(days => ({ timestamp: now - days * (window === '1d' ? 3600 : 86400), apy: 0.03 + index * 0.01 + days * 0.001, apr: 0.03 })),
      ...(id === 'prime' && window === '1d' ? { error: 'History unavailable' } : {}),
    }));
    return route.fulfill({ json: { chainId: 31337, sourceChainId: 1, debtAddress, from: now - (window === '1d' ? 86400 : 7 * 86400), to: now, fetchedAt: now, series } });
  });
  const legend = page.getByRole('list', { name: 'Markets in borrow APY chart' });
  const expectMarkets = async names => {
    await page.waitForFunction(expected => {
      const items = [...document.querySelectorAll('.history-legend li')].map(item => item.querySelector('span:nth-child(2)').textContent);
      return JSON.stringify(items) === JSON.stringify(expected);
    }, names);
    assert.equal(await legend.locator('li').count(), names.length);
  };
  await page.goto(`${base}/31337`);
  await expectMarkets(['V3 Core', 'V4 Main', 'V3 Prime']);
  assert.deepEqual(requests.at(-1).ids, ['core', 'main', 'prime']);
  await page.getByRole('group', { name: /USDC borrow APY history for 3/ }).waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.history-plot path[stroke-width="2"]').length === 3);
  await page.screenshot({ path: '/tmp/borrow-apy-desktop.png', fullPage: true });
  await page.locator('.history-plot').focus();
  await page.keyboard.press('End');
  assert.equal(await page.locator('.history-readout .history-sample').count(), 3, 'tooltip includes every matching market');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '1D', exact: true }).click();
  await page.getByRole('group', { name: /USDC borrow APY history for 2/ }).waitFor();
  await legend.getByText('History unavailable', { exact: true }).waitFor();
  assert.equal(requests.at(-1).window, '1d');
  await page.getByRole('button', { name: 'V4', exact: true }).click();
  await expectMarkets(['V4 Main']);
  assert.equal(requests.at(-1).window, '1d', 'filter changes preserve selected period');
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await expectMarkets(['V3 Core', 'V4 Main', 'V3 Prime']);
  await page.getByRole('button', { name: 'Select debt asset', exact: true }).click();
  await page.getByRole('option', { name: /^DAI DAI/ }).click();
  await expectMarkets(['V3 Core']);
  assert.equal(requests.at(-1).debtAddress.toLowerCase(), dai.toLowerCase());
  await page.getByRole('group', { name: /DAI borrow APY history/ }).waitFor();
  await page.getByRole('button', { name: 'Select debt asset', exact: true }).click();
  await page.getByRole('option', { name: /^USDC USDC/ }).click();
  await expectMarkets(['V3 Core', 'V4 Main', 'V3 Prime']);
  await page.getByRole('button', { name: 'Select collateral asset', exact: true }).click();
  await page.getByRole('option', { name: /^DAI DAI/ }).click();
  await expectMarkets(['V3 Core', 'V4 DAI']);
  await page.getByRole('button', { name: 'Add asset', exact: true }).click();
  await expectMarkets(['V3 Core']);
  await page.getByRole('button', { name: 'V4', exact: true }).click();
  await page.locator('.history-empty').getByText('No markets support this asset and collateral combination.').waitFor();
  assert.equal(await page.locator('.history-plot').count(), 0, 'old chart clears for empty matches');
  await page.getByRole('button', { name: 'Remove collateral 2', exact: true }).click();
  await expectMarkets(['V4 DAI']);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
  await page.screenshot({ path: '/tmp/borrow-apy-mobile.png', fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Passed: all filtered markets, loan asset, collateral, multiple collaterals, version, period, unavailable series, keyboard tooltip, empty state, and mobile layout.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

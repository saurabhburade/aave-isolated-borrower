const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3210';
const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const asset = (symbol, address, icon) => ({ id: `31337/${address}`, address, symbol, name: symbol, decimals: 18, icon });
const weth = asset('WETH', '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2');
const usdt = asset('USDT', '0xdac17f958d2ee523a2206206994597c13d831ec7');
// This asset verifies that Review falls back to catalog artwork after Aave fails.
const remoteIcon = 'https://images.aave.com/test-token-icon.png';
const remote = asset('TEST', '0x0000000000000000000000000000000000000001', remoteIcon);
const cbbtc = asset('cbBTC', '0x0000000000000000000000000000000000000002');
const assets = [weth, usdt, remote, cbbtc];
const market = { id: 'catalog-v3', chainId: 1, version: 3, venue: '0x0000000000000000000000000000000000001234', name: 'Aave V3 Ethereum', network: 'Ethereum', reserves: assets.map(asset => ({ ...asset, usdPrice: asset.symbol === 'WETH' ? '3000' : '1', canSupply: true, canCollateral: true, canBorrow: true, maxLtv: '0.75', liquidationThreshold: '0.8' })) };
let browser;
let page;

(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  page = await browser.newPage({ reducedMotion: 'reduce' });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(owner => {
    window.ethereum = {
      isMetaMask: true, on() {}, removeListener() {},
      request: async ({ method }) => {
        if (method === 'eth_requestAccounts') { sessionStorage.setItem('icon-connected', '1'); return [owner]; }
        if (method === 'eth_accounts') return sessionStorage.getItem('icon-connected') ? [owner] : [];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'eth_sendTransaction') throw new Error('Icon checks must never send a transaction');
        if (method === 'wallet_getCapabilities') return {};
        return '0x' + (999n * 10n ** 18n).toString(16).padStart(64, '0');
      },
    };
  }, owner);
  await page.route('**/api/markets?**', route => route.fulfill({ json: { markets: [], assets: [], freshness: { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: '1' } } }));
  await page.route('**/api/market-catalog?**', route => route.fulfill({ json: { markets: [market], errors: [] } }));
  await page.route('**/api/market-rates?**', route => route.fulfill({ json: { rates: [{ marketId: market.id, borrowApy: '0.04', observedAt: new Date().toISOString() }], errors: [] } }));
  await page.route('**/api/rate-history?**', route => route.fulfill({ json: { series: [], errors: [] } }));
  await page.route('**/_next/image?**', async route => route.fulfill({ contentType: 'image/png', body: await fs.readFile(path.join(__dirname, '../public/tokens/usdc.png')) }));
  await page.route('https://app.aave.com/icons/tokens/*.svg', async route => route.fulfill({ contentType: 'image/svg+xml', body: await fs.readFile(path.join(__dirname, '../public/tokens/weth.svg')) }));
  await page.goto(`${base}/31337`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => {
    const button = document.querySelector('[aria-label="Select debt asset"]');
    return button && Object.keys(button).some(key => key.startsWith('__reactProps'));
  });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
  await page.getByRole('dialog').getByRole('button', { name: /MetaMask|Injected|Browser Wallet/i }).first().click();
  await page.getByRole('textbox', { name: 'Collateral amount 1', exact: true }).fill('1');
  await page.getByRole('textbox', { name: 'Debt amount', exact: true }).fill('500');
  const open = page.getByRole('button', { name: 'Review position', exact: true });
  const review = page.getByRole('dialog', { name: 'Review position' });
  await page.waitForTimeout(500);
  await open.click();
  await review.waitFor();
  const icon = review.locator('.review-receive .token-mark img');
  await icon.waitFor();
  assert.equal(new URL(await icon.getAttribute('src'), base).searchParams.get('url'), 'https://app.aave.com/icons/tokens/usdt.svg', 'USDT uses Aave first even when bundled artwork exists');
  await page.waitForFunction(() => document.querySelector('.review-receive img')?.naturalWidth > 0);
  await review.locator('[data-slot=dialog-close]').click();
  await page.getByRole('button', { name: 'Select debt asset', exact: true }).click();
  await page.getByRole('option').filter({ hasText: 'TEST' }).click();
  await page.getByRole('dialog', { name: 'Select debt asset', exact: true }).waitFor({ state: 'hidden' });
  await page.waitForTimeout(500);
  await open.click();
  await icon.waitFor();
  const source = await icon.getAttribute('src');
  assert.equal(new URL(source, base).pathname, '/_next/image', 'remote artwork uses the image cache');
  assert.equal(new URL(source, base).searchParams.get('url'), 'https://app.aave.com/icons/tokens/test.svg', 'Aave takes priority over the catalog icon URL');
  await icon.dispatchEvent('error');
  await page.waitForFunction(() => {
    const src = document.querySelector('.review-receive img')?.getAttribute('src');
    if (!src) return false;
    const url = new URL(src, location.href);
    return (url.searchParams.get('url') ?? url.href) === 'https://images.aave.com/test-token-icon.png';
  });
  assert.equal(new URL(await icon.getAttribute('src'), base).searchParams.get('url'), remoteIcon, 'Review retains the catalog icon URL as its second choice');
  await icon.dispatchEvent('error');
  await review.locator('.token-art-fallback').waitFor();
  await review.locator('.token-art-fallback svg.lucide-badge-question-mark').waitFor();
  await review.locator('[data-slot=dialog-close]').click();
  await page.getByRole('button', { name: 'Select debt asset', exact: true }).click();
  const picker = page.getByRole('dialog', { name: 'Select debt asset', exact: true });
  const cbbtcOption = picker.getByRole('option').filter({ hasText: 'cbBTC' });
  const cbbtcIcon = cbbtcOption.locator('img');
  const cbbtcSource = new URL(await cbbtcIcon.getAttribute('src'), base);
  assert.equal(cbbtcSource.searchParams.get('url') ?? cbbtcSource.href, 'https://app.aave.com/icons/tokens/cbbtc.svg', 'missing metadata falls back to the lowercase token symbol URL');
  await cbbtcOption.scrollIntoViewIfNeeded();
  await cbbtcIcon.evaluate(img => img.decode());
  await cbbtcIcon.dispatchEvent('error');
  await cbbtcOption.locator('.token-art-fallback svg.lucide-badge-question-mark').waitFor();
  assert.equal(await cbbtcOption.locator('img').count(), 0, 'exhausted sources stop retrying images');
  assert.deepEqual(errors, []);
  console.log('PASS: Aave icons first, catalog URL second, lowercase cbBTC URL in picker, final Lucide fallback. No transactions broadcast.');
})().catch(async error => { console.error(error); if (page) console.error(await page.locator('body').innerText()); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3210';
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const response = await page.request.get(`${base}/api/market-catalog?chainId=31337`);
  assert.ok(response.ok());
  const { markets } = await response.json();
  const assets = markets.flatMap(market => market.reserves).filter(asset => asset.canSupply && asset.canCollateral).filter((asset, index, list) => list.findIndex(candidate => candidate.address.toLowerCase() === asset.address.toLowerCase()) === index);
  const wsteth = assets.find(asset => asset.symbol === 'wstETH');
  assert.ok(wsteth?.icon?.startsWith('https://'), 'live Aave metadata reaches the picker catalog');
  assert.equal(new Set(assets.map(asset => asset.address.toLowerCase())).size, assets.length, 'catalog has no duplicate identities');

  // Keep image loading deterministic while using the live market catalog.
  await page.route('**/_next/image?**', async route => route.fulfill({ contentType: 'image/png', body: await fs.readFile(path.join(__dirname, '../public/tokens/usdc.png')) }));
  await page.goto(`${base}/31337`);
  const open = () => page.getByRole('button', { name: 'Select collateral asset', exact: true }).first().click();
  await open();
  const picker = page.getByRole('dialog', { name: 'Select collateral asset 1' });
  const search = picker.getByLabel('Search tokens or paste address');
  await picker.getByRole('option').first().waitFor();
  const checkLayout = async () => {
    const layout = await picker.evaluate(dialog => {
      const rows = [...dialog.querySelectorAll('.token-option')];
      return {
        overflow: dialog.scrollWidth > dialog.clientWidth,
        bottom: dialog.getBoundingClientRect().bottom,
        height: innerHeight,
        rows: rows.map(row => {
          const icon = row.querySelector('.token-mark').getBoundingClientRect();
          const label = row.querySelector('.token-option-label').getBoundingClientRect();
          return { icon: icon.width, gap: label.x - icon.right };
        }),
      };
    });
    assert.equal(layout.overflow, false, 'picker has no horizontal overflow');
    assert.ok(layout.bottom <= layout.height, `picker fits the viewport height: ${JSON.stringify(layout)}`);
    assert.ok(layout.rows.every(row => row.icon === 28 && row.gap === 12), 'icons stay fixed with a 12px label gap');
  };
  // Let the opening animation settle before measuring pixels.
  await picker.waitFor({ state: 'visible' });
  await page.waitForTimeout(250);
  await checkLayout();
  await search.fill(`  ${wsteth.address.toUpperCase()}  `);
  assert.equal(await picker.getByRole('option').count(), 1, 'address search is case insensitive and trims whitespace');
  const selected = picker.getByRole('option');
  assert.equal(new URL(await selected.locator('img').getAttribute('src'), base).searchParams.get('url'), 'https://app.aave.com/icons/tokens/wsteth.svg');
  await selected.click();
  await picker.waitFor({ state: 'hidden' });
  assert.ok(await page.getByRole('button', { name: 'Select collateral asset', exact: true }).first().textContent().then(text => text.includes('wstETH')));
  await open();
  assert.equal(await search.inputValue(), '', 'closing resets search');
  await search.fill('no-such-token');
  assert.equal(await picker.getByRole('option').count(), 0);
  await picker.getByText('No matching assets.').waitFor();
  await search.fill('');
  await fs.mkdir('/tmp/aave-token-picker', { recursive: true });
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/aave-token-picker/desktop.png' });
  for (const viewport of [{ width: 390, height: 844 }, { width: 390, height: 568 }, { width: 900, height: 500 }]) {
    await page.setViewportSize(viewport);
    await page.waitForTimeout(250);
    await checkLayout();
    const last = picker.getByRole('option').last();
    await last.scrollIntoViewIfNeeded();
    assert.ok(await last.isVisible(), 'last token remains reachable by scrolling');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await search.fill('wstETH');
  await page.waitForTimeout(400);
  await page.screenshot({ path: '/tmp/aave-token-picker/mobile-dark.png' });
  // Simulate a broken provider image without relying on a real CDN outage.
  await picker.getByRole('option').locator('img').dispatchEvent('error');
  await page.waitForFunction(expected => {
    const src = document.querySelector('.token-option img')?.getAttribute('src');
    if (!src) return false;
    const url = new URL(src, location.href);
    return (url.searchParams.get('url') ?? url.href) === expected;
  }, wsteth.icon);
  await picker.getByRole('option').locator('img').dispatchEvent('error');
  await picker.getByRole('option').locator('.token-art-fallback').waitFor();
  await checkLayout();
  assert.deepEqual(errors, []);
  console.log('PASS: live Aave icons, address search, selection, reset, empty state, fixed icon columns, mobile scrolling and image fallback.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

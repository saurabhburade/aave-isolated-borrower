const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.setDefaultNavigationTimeout(30_000);
    const errors = [];
    const waitForHydration = () => page.waitForFunction(() => {
      const button = document.querySelector('.header-wallet');
      return button && Object.keys(button).some((key) => key.startsWith('__reactProps'));
    });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('popup', () => errors.push('Unexpected wallet popup'));
    await page.goto(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3210'}/31337`, { waitUntil: 'domcontentloaded' });
    await waitForHydration();
    assert.equal(await page.evaluate(() => Boolean(window.ethereum)), false, 'test has no injected wallet');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click();
    await page.getByRole('button', { name: 'Anvil Local', exact: true }).click();
    const account = page.getByRole('button', { name: '0xf39F…2266', exact: true });
    await account.waitFor();
    assert.equal(context.pages().length, 1, 'connects without opening a wallet window');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHydration();
    await account.waitFor();
    await account.click();
    await page.locator('[data-testid="rk-disconnect-button"]').click();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().waitFor();
    await page.reload({ waitUntil: 'domcontentloaded' });
    await waitForHydration();
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().waitFor();
    assert.deepEqual(errors, []);
    console.log('Anvil Local: connected without an extension or popup; reconnected on reload; stayed disconnected after reload.');
  } finally {
    await browser.close();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });

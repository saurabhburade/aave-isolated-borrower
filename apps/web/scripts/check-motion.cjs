const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:3210/31337');
      const toggle = page.getByRole('button', { name: 'Toggle dark mode', exact: true });
      await toggle.waitFor();
      await page.waitForTimeout(100);
      const before = await toggle.boundingBox();
      await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
      await page.mouse.down();
      await page.waitForTimeout(200);
      const pressed = await toggle.boundingBox();
      const ratio = pressed.width / before.width;
      assert(Math.abs(ratio - (reducedMotion === 'reduce' ? 1 : 0.96)) < 0.01, `one press scale for ${reducedMotion}: ${ratio}`);
      await page.mouse.up();
      await page.waitForTimeout(400);
      assert(await page.locator('html').evaluate(element => element.classList.contains('dark')), 'pointer action fires once');
      assert.equal(await toggle.locator('svg').count(), 1, 'icon transition settles to one icon');
      assert.equal(await toggle.getAttribute('data-variant'), 'secondary', 'shadcn variant is retained');
      assert.equal(await toggle.getAttribute('data-size'), 'icon', 'shadcn size is retained');
      await toggle.focus();
      await page.keyboard.press('Enter');
      await page.waitForTimeout(400);
      assert.equal(await page.locator('html').evaluate(element => element.classList.contains('dark')), false, 'keyboard activation is retained');
      assert.deepEqual(errors, []);
      console.log(`PASS: ${reducedMotion}, scale=${ratio.toFixed(3)}, pointer + keyboard + icon semantics`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

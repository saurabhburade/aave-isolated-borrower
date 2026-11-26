const assert = require('node:assert/strict');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({
    headless: true,
    chromiumSandbox: true,
    ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}),
  });
  try {
    for (const reducedMotion of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ reducedMotion });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const width of [1440, 768, 390]) {
        await page.setViewportSize({ width, height: 844 });
        await page.goto(`${process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3210'}/31337`);
        await page.waitForFunction(() => {
          const trigger = document.querySelector('[aria-label="Borrow settings"]');
          return trigger && Object.keys(trigger).some(key => key.startsWith('__reactProps'));
        });
        const trigger = page.getByRole('button', { name: 'Borrow settings', exact: true });
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: 'Borrow settings', exact: true });
        await dialog.getByText('1.20', { exact: true }).waitFor();
        await page.waitForFunction(() => {
          const dialog = document.querySelector('[role=dialog]');
          const box = dialog?.getBoundingClientRect();
          return box && Math.abs(box.x + box.width / 2 - innerWidth / 2) < 1
            && Math.abs(box.y + box.height / 2 - innerHeight / 2) < 1
            && Number(getComputedStyle(dialog).opacity) === 1;
        });
        const overlay = page.locator('[data-slot=dialog-overlay]');
        assert.equal(await overlay.count(), 1, 'settings has one backdrop');
        const box = await dialog.boundingBox();
        assert(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 844, 'dialog fits viewport');
        assert.equal(await dialog.evaluate(el => el.classList.contains('ui-dialog')), false, 'no legacy modal styling');
        assert.equal(await dialog.evaluate(el => getComputedStyle(el).animationName), 'none', 'Motion owns animation without competing CSS keyframes');
        const checkboxes = dialog.getByRole('checkbox');
        if (await checkboxes.count()) {
          const checkbox = checkboxes.first();
          const checked = await checkbox.isChecked();
          await checkbox.click();
          assert.equal(await checkbox.isChecked(), !checked, 'collateral setting changes');
          await checkbox.click();
        }
        await dialog.getByRole('button', { name: 'Done', exact: true }).click();
        await dialog.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Borrow settings');
        await page.keyboard.press('Enter');
        await dialog.waitFor();
        await page.keyboard.press('Escape');
        await dialog.waitFor({ state: 'hidden' });
        await page.getByRole('button', { name: 'Select debt asset', exact: true }).click();
        const picker = page.getByRole('dialog', { name: 'Select debt asset', exact: true });
        await picker.waitFor();
        assert.equal(await overlay.count(), 1, 'asset picker has its own backdrop while settings is closed');
        await page.waitForFunction(() => {
          const overlay = document.querySelector('[data-slot=dialog-overlay]');
          return overlay && Number(getComputedStyle(overlay).opacity) === 1;
        });
        const backdrop = await overlay.evaluate(el => { const style = getComputedStyle(el); const rect = el.getBoundingClientRect(); return { color: style.backgroundColor, blur: style.backdropFilter, width: rect.width, height: rect.height }; });
        assert.notEqual(backdrop.color, 'rgba(0, 0, 0, 0)', 'backdrop dims the page');
        assert.notEqual(backdrop.blur, 'none', 'backdrop blurs the page');
        assert.equal(backdrop.width, width, 'backdrop covers viewport width');
        assert.equal(backdrop.height, 844, 'backdrop covers viewport height');
        await page.keyboard.press('Escape');
        await picker.waitFor({ state: 'hidden' });
        console.log(`PASS: ${width}px, ${reducedMotion}, centered shadcn dialog, settings, Done, keyboard open/close, focus restoration`);
      }
      assert.deepEqual(errors, [], 'no browser page errors');
      await context.close();
    }
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

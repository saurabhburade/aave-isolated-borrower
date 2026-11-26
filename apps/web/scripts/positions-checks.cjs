const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');
const { decodeFunctionData, encodeFunctionResult, parseAbi } = require('viem');

const base = process.env.BROWSER_BASE_URL || 'http://127.0.0.1:3210';
const artifacts = process.env.BROWSER_ARTIFACTS || '/tmp/aave-positions-checks';
const owner = '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266';
const fresh = { status: 'fresh', observedAt: new Date().toISOString(), blockNumber: '123' };
const asset = (symbol) => ({ id: symbol, address: '0x' + (symbol === 'USDC' ? '2' : symbol === 'wstETH' ? '3' : '1').repeat(40), symbol, name: symbol, decimals: 18 });
const fixture = (i) => ({
  id: String(i), chainId: 31337, account: '0x' + String(i + 1).padStart(40, '0'), owner, salt: '0x' + '0'.repeat(64),
  market: { id: 'market-' + i, chainId: 31337, version: i % 2 ? 4 : 3, venue: '0x' + '2'.repeat(40), name: i % 2 ? 'Ethereum Main Spoke' : 'Ethereum Core', network: 'Anvil', assets: [asset('WETH'), asset('USDC')], status: 'available' },
  collaterals: [{ asset: asset('WETH'), amount: '2.5', collateralEnabled: true }, { asset: asset('wstETH'), amount: '1', collateralEnabled: true }],
  debts: [{ asset: asset('USDC'), amount: String((i + 1) * 100), collateralEnabled: false, apy: '0.04' }],
  risk: { healthFactor: String(2 + i / 10), debtUsd: String((i + 1) * 100), collateralUsd: '10000', ltv: '0.1', borrowCapacityUsd: '6000' },
  freshness: fresh, activity: [], status: 'open',
});

let browser;
let page;
(async () => {
  await fs.mkdir(artifacts, { recursive: true });
  browser = await chromium.launch({ headless: true, chromiumSandbox: true, ...(process.env.HEADLESS_CHROMIUM ? { executablePath: process.env.HEADLESS_CHROMIUM } : {}) });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
  await context.addInitScript(({ owner }) => {
    const listeners = new Map();
    window.ethereum = {
      isMetaMask: true,
      on: (event, callback) => { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(callback); },
      removeListener: (event, callback) => listeners.get(event)?.delete(callback),
      request: async ({ method, params }) => {
        if (method === 'eth_requestAccounts') { sessionStorage.setItem('positions-test-connected', '1'); return [owner]; }
        if (method === 'eth_accounts') return sessionStorage.getItem('positions-test-connected') ? [owner] : [];
        if (method === 'eth_chainId') return '0x7a69';
        if (method === 'wallet_requestPermissions' || method === 'wallet_getPermissions') return [{ parentCapability: 'eth_accounts' }];
        if (method === 'wallet_getCapabilities') return {};
        if (method === 'eth_sendTransaction') {
          window.positionsTestSignAttempts = (window.positionsTestSignAttempts ?? 0) + 1;
          window.positionsTestTransactions = [...(window.positionsTestTransactions ?? []), params[0]];
          throw Object.assign(new Error('User rejected the request.'), { code: 4001 });
        }
        // Signature requests are rejected locally; tests never broadcast transactions.
        throw new Error('Unsupported test wallet method: ' + method);
      },
    };
    window.changePositionsTestOwner = (address) => {
      listeners.get('accountsChanged')?.forEach((listener) => listener(address ? [address] : []));
    };
  }, { owner });
  page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let rows = Array.from({ length: 12 }, (_, i) => fixture(i));
  // Multiple eligible V4 reserves can share a wallet token. The picker keeps one row.
  for (const row of rows) row.market.assets.push({ ...asset('USDC'), id: 'USDC-second-reserve', reserveId: '7' });
  let freshness = fresh;
  let delay = 0;
  let requests = 0;
  await page.route('**/api/positions?**', async (route) => {
    requests++;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    await route.fulfill({ json: { positions: rows, freshness } });
  });

  await page.route('**/api/market-catalog?**', (route) => route.fulfill({ json: { markets: [3, 4].map((version) => ({
    ...fixture(version === 3 ? 0 : 1).market, chainId: 1, version, isTestnet: false,
    reserves: [...['WETH', 'wstETH', 'USDC'].map(asset), { ...asset('USDC'), reserveId: '7' }].map((token) => ({ ...token, canSupply: true, canBorrow: true, canCollateral: true, usdPrice: token.symbol === 'USDC' ? '1' : '1000', maxLtv: '0.75', liquidationThreshold: '0.8' })),
  })), errors: [] } }));
  // Read-only call succeeds, then the injected wallet rejects the signature.
  const multicallAbi = parseAbi(['function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[] returnData)']);
  const simulationRpc = async (route) => {
    const payload = route.request().postDataJSON();
    const batch = Array.isArray(payload) ? payload : [payload];
    if (!batch.every(call => ['eth_call', 'eth_chainId', 'eth_blockNumber'].includes(call.method))) return route.continue();
    const results = batch.map(call => {
      let result = call.method === 'eth_chainId' ? '0x7a69' : call.method === 'eth_blockNumber' ? '0x7b' : '0x' + (10000n * 10n ** 18n).toString(16).padStart(64, '0');
      if (call.method === 'eth_call' && call.params[0].data.startsWith('0x82ad56cb')) {
        const { args } = decodeFunctionData({ abi: multicallAbi, data: call.params[0].data });
        result = encodeFunctionResult({ abi: multicallAbi, functionName: 'aggregate3', result: args[0].map(() => ({ success: true, returnData: '0x' + (10000n * 10n ** 18n).toString(16).padStart(64, '0') })) });
      }
      return { jsonrpc: '2.0', id: call.id, result };
    });
    await route.fulfill({ json: Array.isArray(payload) ? results : results[0] });
  };
  await page.route('http://127.0.0.1:8557/**', simulationRpc);
  await page.route('http://127.0.0.1:8557', simulationRpc);
  await page.goto(base + '/31337/positions');
  await page.getByRole('heading', { name: 'My Positions', exact: true }).waitFor();
  assert.equal(await page.getByRole('tablist').count(), 0, 'portfolio shows a title without tabs');
  await page.locator('.portfolio-metric').nth(3).waitFor();
  assert.equal(await page.locator('.portfolio-metric').count(), 4);
  await page.locator('.portfolio-empty').getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: /MetaMask|Injected|Browser Wallet/i }).first().click();
  await page.getByRole('table').waitFor();
  await page.getByText('1–10 of 12 positions', { exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 10);
  assert.equal(await page.locator('.portfolio-position-amount').first().innerText(), '100 USDC\n$100.00');
  assert.match(await page.locator('.portfolio-position-amount').nth(1).innerText(), /wstETH/);
  assert.match(await page.getByRole('region', { name: 'Portfolio borrow APY', exact: true }).innerText(), /4.00/);
  await page.getByRole('button', { name: 'Debt', exact: true }).click();
  await page.getByRole('columnheader', { name: 'Debt', exact: true }).getAttribute('aria-sort').then((sort) => assert.equal(sort, 'ascending'));
  await page.getByRole('button', { name: 'Debt', exact: true }).click();
  assert.match(await page.locator('tbody tr').first().innerText(), /1,200 USDC/);
  await page.getByRole('button', { name: 'Next page of positions', exact: true }).click();
  await page.getByText('11–12 of 12 positions', { exact: true }).waitFor();
  assert.equal(await page.locator('tbody tr').count(), 2);
  assert.equal(await page.locator('a[href^="/31337/positions/"]').count(), 0, 'individual position pages have no links');
  await page.getByRole('button', { name: 'Previous page of positions', exact: true }).click();
  await page.getByRole('button', { name: /^Manage .* account/ }).first().click();
  const manage = page.getByRole('dialog', { name: 'Manage position', exact: true });
  await manage.getByRole('textbox', { name: 'Management amount', exact: true }).waitFor();
  assert.equal(await manage.getByRole('tab').count(), 3, 'three primary management actions');
  assert.deepEqual(await manage.getByRole('tab').allTextContents(), ['Repay', 'Add collateral', 'Remove collateral']);
  assert.equal(await manage.getByRole('button', { name: 'Management asset', exact: true }).count(), 0, 'single debt asset is fixed without a picker');
  assert.equal(await manage.getByLabel('Loan asset', { exact: true }).innerText(), 'USDC');
  const picker = page.getByRole('dialog', { name: 'Select collateral asset', exact: true });
  const selectCollateral = async (symbol) => {
    await manage.getByRole('button', { name: 'Management asset', exact: true }).click();
    await picker.getByRole('option').filter({ hasText: symbol }).first().click();
    await picker.waitFor({ state: 'hidden' });
  };
  assert.equal(await manage.getByRole('button', { name: 'Confirm', exact: true }).isDisabled(), true, 'requires an asset and positive amount');
  let managementRequests = 0;
  await page.route('**/api/manage', route => {
    managementRequests++;
    return route.fulfill({ status: 503, json: { error: 'Confirmation must not use the management backend.' } });
  });
  await manage.getByRole('tab', { name: 'Add collateral', exact: true }).click();
  await manage.getByRole('button', { name: 'Management asset', exact: true }).click();
  await picker.getByLabel('Search tokens or paste address').fill('no-such-token');
  await picker.getByText('No matching assets.', { exact: true }).waitFor();
  await page.keyboard.press('Escape');
  await picker.waitFor({ state: 'hidden' });
  assert.equal(await manage.isVisible(), true, 'closing nested picker keeps management open');
  await manage.getByRole('button', { name: 'Management asset', exact: true }).click();
  assert.equal(await picker.getByLabel('Search tokens or paste address').inputValue(), '', 'picker search resets on reopen');
  assert.equal(await picker.getByRole('option').count(), 2, 'add collateral shows one row per token address across eligible reserves');
  await picker.getByRole('button', { name: 'Close token picker', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  await selectCollateral('WETH');
  await manage.getByLabel('Management amount', { exact: true }).fill('0.1');
  const impact = manage.locator('.manage-impact');
  const nextImpact = impact.locator('.manage-impact-next');
  await nextImpact.nth(1).getByText('$10,100.00', { exact: true }).first().waitFor();
  assert.equal(await manage.locator('.manage-details').count(), 0, 'typing previews impact without opening review');
  assert.equal(await manage.getByRole('button', { name: 'Confirm', exact: true }).isVisible(), true, 'live preview offers direct confirmation');
  await manage.screenshot({ path: path.join(artifacts, 'management-live-add-light.png') });
  const reopenAddCollateral = async () => {
    await page.keyboard.press('Escape');
    await manage.waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: /^Manage .* account/ }).first().click();
    await manage.getByRole('tab', { name: 'Add collateral', exact: true }).click();
    await selectCollateral('WETH');
  };
  // The shared motion hook reads the preference when each component mounts.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await reopenAddCollateral();
  await manage.getByLabel('Management amount', { exact: true }).fill('0.1');
  await nextImpact.nth(1).getByText('$10,100.00', { exact: true }).first().waitFor();
  await page.waitForTimeout(600);
  await manage.getByLabel('Management amount', { exact: true }).fill('0.15');
  const digitsSettled = () => [...document.querySelectorAll('.manage-impact-next .manage-digit')].every((digit) => {
    const strip = digit.querySelector('.manage-digit-strip');
    const offset = new DOMMatrixReadOnly(getComputedStyle(strip).transform).m42;
    return Math.abs(offset + Number(digit.dataset.digit) * parseFloat(getComputedStyle(digit).fontSize) * 1.25) < 0.2;
  });
  await page.waitForFunction(() => [...document.querySelectorAll('.manage-impact-next .manage-digit')].some((digit) => {
    const offset = new DOMMatrixReadOnly(getComputedStyle(digit.querySelector('.manage-digit-strip')).transform).m42;
    return Math.abs(offset + Number(digit.dataset.digit) * parseFloat(getComputedStyle(digit).fontSize) * 1.25) > 0.5;
  }));
  await nextImpact.nth(1).getByText('$10,150.00', { exact: true }).first().waitFor();
  await page.waitForFunction(digitsSettled);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reopenAddCollateral();
  await manage.getByLabel('Management amount', { exact: true }).fill('0.3');
  await manage.getByLabel('Management amount', { exact: true }).fill('0.4');
  await nextImpact.nth(1).getByText('$10,400.00', { exact: true }).first().waitFor();
  await page.waitForTimeout(900);
  assert.match(await nextImpact.nth(1).innerText(), /10,400.00/, 'estimate follows the latest input');
  await manage.getByLabel('Management amount', { exact: true }).fill('');
  await nextImpact.first().waitFor({ state: 'hidden' });
  await manage.getByLabel('Management amount', { exact: true }).fill('0.1');
  await nextImpact.nth(1).getByText('$10,100.00', { exact: true }).first().waitFor();
  await impact.getByText('Health Factor', { exact: true }).waitFor();
  assert.equal(managementRequests, 0, 'typing uses local estimates without management validation requests');
  assert.equal(await manage.locator('.manage-details, .manage-approvals, .manage-transfers').count(), 0, 'technical review sections are removed');
  assert.equal(await manage.getByRole('button', { name: /Review|Edit action/ }).count(), 0, 'no separate review step');
  assert.equal(await manage.locator('svg.lucide-move-right').count(), 2, 'both metrics use MoveRight');
  await manage.screenshot({ path: path.join(artifacts, 'management-confirm-desktop-light.png') });
  await manage.getByLabel('Management amount', { exact: true }).fill('0.2');
  assert.equal(await manage.locator('.manage-details').count(), 0, 'editing invalidates the reviewed plan');
  await manage.getByRole('tab', { name: 'Repay', exact: true }).click();
  assert.equal(await manage.getByLabel('Management amount', { exact: true }).inputValue(), '', 'switching action clears amount');
  assert.equal(await manage.getByLabel('Loan asset', { exact: true }).innerText(), 'USDC', 'repay binds directly to the debt asset');
  await manage.getByLabel('Management amount', { exact: true }).fill('4.000002');
  await nextImpact.nth(1).getByText('$1,196.00', { exact: true }).first().waitFor();
  await manage.getByLabel('Management amount', { exact: true }).focus();
  const amountStyle = await manage.getByRole('textbox', { name: 'Management amount', exact: true }).evaluate((element) => {
    const style = getComputedStyle(element);
    return { border: style.borderWidth, shadow: style.boxShadow };
  });
  assert.equal(amountStyle.border, '0px', 'amount input stays borderless when focused');
  assert.equal(amountStyle.shadow, 'none', 'amount input has no separate focus box');
  assert(await manage.locator('.manage-amount-card').evaluate((element) => element.getBoundingClientRect().height < 150), 'amount card remains compact');
  await manage.screenshot({ path: path.join(artifacts, 'management-repay-minimal-light.png') });
  await manage.getByRole('button', { name: 'Max', exact: true }).click();
  await nextImpact.nth(1).getByText('$0.00', { exact: true }).first().waitFor();
  await nextImpact.nth(2).getByText('$0.00', { exact: true }).first().waitFor();
  await manage.getByRole('status').getByText("You're repaying the full debt and withdrawing all collateral in one transaction.", { exact: true }).waitFor();
  await impact.getByText('Health Factor', { exact: true }).waitFor();

  await manage.getByLabel('Management amount', { exact: true }).fill('1');
  await nextImpact.nth(1).getByText('$1,199.00', { exact: true }).first().waitFor({ timeout: 5000 });
  await impact.getByText('Health Factor', { exact: true }).waitFor();
  const beforeConfirm = managementRequests;
  await manage.getByRole('button', { name: 'Confirm', exact: true }).click();
  await manage.getByText(/User rejected/).first().waitFor({ timeout: 5000 });
  assert.equal(managementRequests, beforeConfirm, 'one click reaches the wallet without a management backend request');
  assert.equal(await page.evaluate(() => window.positionsTestSignAttempts), 1, 'confirm reaches the wallet without another review step');
  await manage.getByRole('tab', { name: 'Remove collateral', exact: true }).click();
  await manage.getByRole('status').getByText('Keep your health factor at or above 1.06 when removing collateral.', { exact: true }).waitFor();
  await manage.getByRole('button', { name: 'Management asset', exact: true }).click();
  assert.equal(await picker.getByRole('option').filter({ hasText: 'USDC' }).count(), 0, 'remove collateral picker excludes debt-only assets');
  await picker.getByRole('button', { name: 'Close token picker', exact: true }).click();
  await picker.waitFor({ state: 'hidden' });
  await selectCollateral('WETH');
  await manage.getByLabel('Management amount', { exact: true }).fill('0.1');
  await nextImpact.nth(1).getByText('$9,900.00', { exact: true }).first().waitFor();
  await manage.screenshot({ path: path.join(artifacts, 'management-live-remove-light.png') });
  await manage.getByRole('button', { name: 'Max', exact: true }).click();
  await nextImpact.nth(1).getByText('$7,500.00', { exact: true }).first().waitFor();
  await impact.getByText('Health Factor', { exact: true }).waitFor();

  await manage.getByRole('tab', { name: 'Remove collateral', exact: true }).focus();
  await page.keyboard.press('Home');
  assert.equal(await manage.getByRole('tab', { name: 'Repay', exact: true }).getAttribute('aria-selected'), 'true', 'management tabs support keyboard navigation');
  await manage.getByLabel('Management amount', { exact: true }).fill('1');
  await nextImpact.nth(1).getByText('$1,199.00', { exact: true }).first().waitFor();
  await page.evaluate(() => document.documentElement.classList.add('dark'));
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await manage.evaluate((element) => element.scrollWidth > element.clientWidth), false, 'mobile modal has no horizontal overflow');
  assert.equal(await manage.locator('[role=tablist]').evaluate((element) => element.scrollWidth > element.clientWidth), false, 'all three mobile tabs fit');
  await page.screenshot({ path: path.join(artifacts, 'management-review-mobile-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 320, height: 720 });
  assert.equal(await manage.evaluate((element) => element.scrollWidth > element.clientWidth), false, 'small mobile modal has no horizontal overflow');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.classList.remove('dark'));
  await page.keyboard.press('Escape');
  await manage.waitFor({ state: 'hidden' });
  await page.screenshot({ path: path.join(artifacts, 'positions-desktop-light.png'), fullPage: true });

  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  await page.screenshot({ path: path.join(artifacts, 'positions-desktop-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'mobile document does not overflow');
  const container = page.locator('[data-slot=table-container]').first();
  assert(await container.evaluate((el) => el.scrollWidth > el.clientWidth), 'mobile table scrolls within its own container');
  await page.screenshot({ path: path.join(artifacts, 'positions-mobile-dark.png'), fullPage: true });
  await page.getByRole('button', { name: 'Toggle dark mode' }).click();
  await page.screenshot({ path: path.join(artifacts, 'positions-mobile-light.png'), fullPage: true });

  await page.setViewportSize({ width: 1440, height: 1000 });
  delay = 1200;
  const before = requests;
  await page.getByRole('button', { name: 'Refresh portfolio' }).click();
  await page.waitForFunction(() => document.querySelector('.portfolio-overview')?.getAttribute('aria-busy') === 'true');
  assert.equal(await page.locator('tbody tr').count(), 10, 'refresh keeps existing rows visible');
  await page.waitForFunction(() => document.querySelector('.portfolio-overview')?.getAttribute('aria-busy') === 'false');
  assert(requests > before, 'refresh requests native data');

  // Missing rates must not be presented as free borrowing; real zero rates retain %.
  delay = 0;
  rows = [fixture(1), fixture(3), fixture(5), fixture(7)];
  delete rows[0].debts[0].apy;
  rows[1].debts[0].apy = '0';
  rows[2].freshness = { ...fresh, status: 'stale' };
  await page.getByRole('button', { name: 'Refresh portfolio' }).click();
  await page.getByText('1–4 of 4 positions', { exact: true }).waitFor();
  const rateCells = page.locator('tbody tr').locator('td:nth-child(4)');
  assert.deepEqual((await rateCells.allTextContents()).sort(), ['0.00%', '4.00%', 'Unavailable', 'Unavailable'].sort());
  await page.screenshot({ path: path.join(artifacts, 'positions-borrow-apy.png'), fullPage: true });

  rows = [];
  await page.getByRole('button', { name: 'Refresh portfolio' }).click();
  await page.getByText('No open positions yet.', { exact: true }).waitFor();
  assert.match(await page.getByRole('region', { name: 'Debt and collateral', exact: true }).innerText(), /\$0.00/);
  freshness = { status: 'unavailable', observedAt: null, blockNumber: null, reason: 'Native RPC temporarily unavailable.' };
  await page.getByRole('button', { name: 'Refresh portfolio' }).click();
  await page.getByRole('alert').getByText('Native RPC temporarily unavailable.', { exact: true }).waitFor();
  assert(!/\$0.00/.test(await page.getByRole('region', { name: 'Debt and collateral', exact: true }).innerText()), 'unavailable values are not displayed as zeros');

  rows = [{ ...fixture(0), debts: [{ ...fixture(0).debts[0], amount: '4.000002' }], risk: { ...fixture(0).risk, debtUsd: '3.99954248', healthFactor: '347.32359339381238426', collateralUsd: '1653.73269772' } }]; freshness = fresh;
  await page.getByRole('button', { name: 'Refresh portfolio' }).click();
  await page.getByText('1–1 of 1 positions', { exact: true }).waitFor();
  await page.getByRole('button', { name: /^Manage .* account/ }).first().click();
  await manage.getByLabel('Management amount', { exact: true }).fill('111');
  await nextImpact.nth(0).getByText('No debt', { exact: true }).first().waitFor();
  await nextImpact.nth(1).getByText('$0.00', { exact: true }).first().waitFor();
  await manage.getByRole('button', { name: 'Confirm', exact: true }).click();
  await manage.getByText(/User rejected/).first().waitFor({ timeout: 5000 });
  const lastTransaction = await page.evaluate(() => window.positionsTestTransactions.at(-1));
  const { args } = decodeFunctionData({ abi: parseAbi(['function execute((address token,uint256 amount)[] funding,(uint8 kind,address token,uint256 reserveId,uint256 amount,bool enabled)[] actions,(uint256 deadline,uint256 minHealthFactor,uint256 maxBorrowRateRay) limits)']), data: lastTransaction.data });
  assert.deepEqual(args[1].map(action => action.kind), [3, 1, 1], 'repaying the last debt also withdraws all collateral');
  assert.equal(await page.evaluate(() => window.positionsTestSignAttempts), 2);
  assert.equal(managementRequests, 0, 'all management actions bypass the backend');
  await manage.screenshot({ path: path.join(artifacts, 'management-repay-over-debt.png') });
  await page.keyboard.press('Escape');
  await manage.waitFor({ state: 'hidden' });
  delay = 2000;
  await page.evaluate(() => window.changePositionsTestOwner('0x' + '9'.repeat(40)));
  await page.getByRole('status', { name: 'Loading positions' }).waitFor();
  assert.equal(await page.locator('tbody tr').filter({ hasText: 'USDC' }).count(), 0, 'wallet switch clears prior account rows immediately');
  await page.getByText('1–1 of 1 positions', { exact: true }).waitFor();
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(JSON.stringify({ status: 'PASS', checks: ['summary', 'borrow APY availability', 'multi-asset balances', 'sorting', 'pagination', 'management keyboard tabs', 'management dialog', 'direct confirmation', 'estimate fallback', 'digit rolling', 'positions title without tabs', 'light and dark', 'mobile overflow', 'refresh', 'empty', 'unavailable', 'wallet switch'], artifacts }));
})().catch(async (error) => { console.error(error); console.error(await page?.getByRole('dialog', { name: 'Manage position', exact: true }).innerText().catch(() => 'Management dialog unavailable')); process.exitCode = 1; }).finally(async () => { await browser?.close(); });

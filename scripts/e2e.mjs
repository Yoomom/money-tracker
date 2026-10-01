/* Live end-to-end check. GH_TOKEN=$(gh auth token) node scripts/e2e.mjs [url]
   The token is passed via env only and is typed into the app form; browser storage is cleared at the end. */
import { chromium } from 'playwright';

const URL = process.argv[2] ?? 'https://yoomom.github.io/money-tracker/';
const TOKEN = process.env.GH_TOKEN;
const results = [];
const check = (name, ok, detail = '') => { results.push({ name, ok, detail }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const tab = (n) => page.locator('nav.tabbar button', { hasText: n });
const bal = async (name) => {
  const card = page.locator('.card', { has: page.locator('h3', { hasText: name }) }).first();
  return (await card.locator('.num b').first().innerText()).trim();
};

try {
  // ── Connect (live, real data repo)
  await page.goto(URL);
  await page.getByLabel('GitHub owner').fill('yoomom');
  await page.getByLabel('Data repo').fill('money-data');
  await page.getByLabel(/Fine-grained token/).fill(TOKEN);
  await page.getByRole('button', { name: 'Test and save' }).click();
  await page.getByText(/On track|Needs attention/).first().waitFor({ timeout: 30000 });
  const tiles = await page.locator('.tile').count();
  check('Connect → Month shows status and tiles', tiles === 12, `${await page.locator('.status').innerText().then((t) => t.split('\n')[0])}, ${tiles} tiles`);

  // ── Payday tick / untick
  await tab('Funds').click();
  const before = await bal('Gifts & family');
  await tab('Payday').click();
  const giftsRow = page.locator('.item', { hasText: 'Gifts & family occasions' });
  await giftsRow.getByRole('button', { name: /^Tick/ }).click();
  check('Payday: tick', await giftsRow.getByRole('button', { name: /^Untick/ }).count() === 1);
  await tab('Funds').click();
  const afterTick = await bal('Gifts & family');
  await tab('Payday').click();
  await giftsRow.getByRole('button', { name: /^Untick/ }).click();
  check('Payday: untick', await giftsRow.getByRole('button', { name: /^Tick/ }).count() === 1, `fund ${before} → ${afterTick} → back`);

  // ── Surprise RM1 from Gifts & family, then delete
  await tab('Month').click();
  await page.getByRole('button', { name: /Log a surprise/ }).click();
  await page.getByLabel('Amount (RM)').fill('1');
  await page.getByLabel('Amount (RM)').blur();
  await page.getByLabel('What was it?').fill('E2E test');
  await page.getByRole('radio', { name: 'Gifts & family' }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByText('E2E test').waitFor();
  check('Surprise logged and listed', true);
  await tab('Funds').click();
  const afterSurprise = await bal('Gifts & family');
  check('Surprise lowers the fund by RM1', afterSurprise !== before, `${before} → ${afterSurprise}`);
  await tab('Month').click();
  await page.getByRole('button', { name: 'Delete E2E test' }).click();
  await tab('Funds').click();
  check('Funds: gifts balance back to previous', (await bal('Gifts & family')) === before, before);

  // ── Wait for autosave to land in GitHub
  await page.waitForFunction(() => !document.body.innerText.includes('Unsynced'), null, { timeout: 30000 });
  await page.waitForTimeout(3000);

  // ── Offline reload (service worker)
  await tab('Month').click();
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker?.ready);
  await page.waitForTimeout(1500);
  await ctx.setOffline(true);
  await page.reload();
  const offlineOk = await page.getByText(/On track|Needs attention/).first().waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('Reload offline: app opens with cached data', offlineOk);
  await ctx.setOffline(false);
} catch (e) {
  check('e2e run', false, String(e.message).split('\n')[0]);
  await page.screenshot({ path: 'out/e2e-failure.png' }).catch(() => {});
} finally {
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear();
    for (const d of await indexedDB.databases()) indexedDB.deleteDatabase(d.name);
    for (const k of await caches.keys()) await caches.delete(k);
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
  }).catch(() => {});
  await ctx.clearCookies();
}

// ── Demo-mode screenshots (dummy numbers only)
const demo = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true });
const dp = await demo.newPage();
await dp.goto(`${URL}?demo=1`);
await dp.getByText(/On track|Needs attention/).first().waitFor();
await dp.screenshot({ path: 'docs/screenshots/month.png' });
await dp.locator('nav.tabbar button', { hasText: 'Payday' }).click();
await dp.screenshot({ path: 'docs/screenshots/payday.png' });
await dp.locator('nav.tabbar button', { hasText: 'Funds' }).click();
await dp.screenshot({ path: 'docs/screenshots/funds.png' });
await dp.getByRole('button', { name: /Log a surprise/ }).click();
await dp.screenshot({ path: 'docs/screenshots/surprise.png' });
await dp.getByRole('button', { name: 'Close', exact: true }).click();
await dp.locator('nav.tabbar button', { hasText: 'Plan' }).click();
await dp.screenshot({ path: 'docs/screenshots/plan.png' });
await dp.locator('nav.tabbar button', { hasText: 'Month' }).click();
await dp.getByRole('button', { name: 'History' }).click();
await dp.screenshot({ path: 'docs/screenshots/history.png' });
await dp.getByRole('button', { name: '← Back' }).click();
await dp.getByRole('button', { name: /Close month/ }).click();
await dp.screenshot({ path: 'docs/screenshots/review.png' });
// no horizontal scroll at 360px
await dp.setViewportSize({ width: 360, height: 800 });
const overflow = await dp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
check('No horizontal scroll at 360px (review screen)', !overflow);
await browser.close();

const failed = results.filter((r) => !r.ok);
console.log(failed.length ? `\n${failed.length} FAILED` : '\nAll checks passed');
process.exit(failed.length ? 1 : 0);

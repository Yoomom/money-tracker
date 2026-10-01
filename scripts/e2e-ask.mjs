/* Ask tab flow against a local preview in demo mode (mock AI, mock storage). Usage: node scripts/e2e-ask.mjs [baseUrl] */
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:4173/money-tracker/';
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const violations = [];
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text()); });
page.on('pageerror', (e) => violations.push(String(e)));
const tab = (n) => page.locator('nav.tabbar button', { hasText: n });
const carBal = async () => {
  await tab('Funds').click();
  const t = await page.locator('.card', { has: page.locator('h3', { hasText: 'Car wear' }) }).locator('.num b').first().innerText();
  await tab('Ask').click();
  return t.trim();
};
try {
  await page.goto(`${BASE}?demo=1`);
  await page.getByText(/On track|Needs attention/).first().waitFor();
  const before = await carBal();
  await page.getByRole('button', { name: 'Am I on track this month?' }).click();
  await page.locator('.toolchip').first().waitFor();
  await page.getByText('Mostly on track').waitFor();
  check('Quick prompt → tool chip → answer with table', (await page.locator('.md table').count()) === 1, await page.locator('.toolchip').first().innerText());
  check('Cost footer shown', await page.getByText(/~US\$0\.\d+ · \d+k in/).count() > 0);
  await page.screenshot({ path: 'docs/screenshots/ask.png' });

  await page.getByLabel('Message').fill('Log RM350 car service from car fund');
  await page.getByRole('button', { name: 'Send' }).click();
  await page.getByRole('group', { name: 'Proposed change' }).waitFor();
  check('Proposal card appears with a diff', (await page.locator('.proposal li').count()) > 0, await page.locator('.proposal b').innerText());
  await page.screenshot({ path: 'docs/screenshots/ask-proposal.png' });
  check('Nothing changed before Apply', (await carBal()) === before);
  await page.getByRole('button', { name: 'Apply' }).click();
  const applied = await carBal();
  check('Apply updates the Funds screen', applied !== before, `${before} → ${applied}`);
  await page.getByRole('button', { name: 'Undo' }).click();
  check('Undo restores it', (await carBal()) === before, before);

  await ctx.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  check('Offline disables send', await page.getByLabel('Message').isDisabled());
  await ctx.setOffline(false);
  check('No CSP violations or page errors', violations.length === 0, violations.join(' | '));
  await page.setViewportSize({ width: 360, height: 800 });
  check('No horizontal scroll at 360px', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));

  // no key (non-demo): setup instructions, nothing else breaks
  const p2 = await ctx.newPage();
  await p2.goto(BASE);
  check('Without a connection the app shows Connect (no crash)', await p2.getByText('Money Tracker').first().isVisible());
} catch (e) { check('ask e2e', false, String(e.message).split('\n')[0]); await page.screenshot({ path: 'out/ask-failure.png' }); }
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);

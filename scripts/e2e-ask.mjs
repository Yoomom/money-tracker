/* Ask Claude bridge flow against a local preview in demo mode (mock storage). Usage: node scripts/e2e-ask.mjs [baseUrl] */
import { chromium } from 'playwright';
const BASE = process.argv[2] ?? 'http://localhost:4173/money-tracker/';
const results = [];
const check = (n, ok, d = '') => { results.push(ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${d ? ` — ${d}` : ''}`); };

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', permissions: ['clipboard-read', 'clipboard-write'] });
await ctx.route('https://claude.ai/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: 'claude' }));
const page = await ctx.newPage();
const bad = [];
page.on('console', (m) => { if (/Content Security Policy|Refused to/i.test(m.text())) bad.push(m.text()); });
page.on('pageerror', (e) => bad.push(String(e)));
const requests = [];
page.on('request', (r) => requests.push(r.url()));
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
  const popup = ctx.waitForEvent('page');
  await page.getByRole('button', { name: 'Am I on track this month?' }).click();
  await page.getByText('Copied — paste into Claude.').waitFor();
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  check('Clipboard has coach prompt, data snapshot, change schema and the question',
    clip.includes("Shaq's money coach") && clip.includes('"health":[[') && clip.includes('money-changes') && clip.trim().endsWith('Am I on track this month?'), `${clip.length} chars`);
  check('No tokens in the packed text', !/github_pat|gho_|ghp_/.test(clip));
  const p = await popup;
  check('Opens claude.ai/new', p.url().startsWith('https://claude.ai/new'));
  await p.close();
  await page.screenshot({ path: 'docs/screenshots/ask.png' });

  const reply = 'You can cover it from the car fund.\n\n```money-changes\n[{"type":"log_surprise","date":"2026-10-08","what":"Car service","rm":350,"paidFrom":"car-wear","emergency":false}]\n```\n';
  await page.getByRole('button', { name: 'Or paste into a box' }).click();
  await page.getByLabel('Claude reply').fill(reply);
  await page.getByRole('button', { name: 'Preview changes' }).click();
  await page.getByRole('group', { name: 'Proposed changes' }).waitFor();
  check('Preview shows a before → after', (await page.locator('.proposal li').first().innerText()).includes('→'), await page.locator('.proposal b').first().innerText());
  await page.screenshot({ path: 'docs/screenshots/ask-preview.png' });
  check('Nothing changed before Apply', (await carBal()) === before);
  await page.getByRole('button', { name: 'Or paste into a box' }).click().catch(() => {});
  if (!(await page.getByRole('button', { name: 'Apply', exact: true }).count())) {
    await page.getByLabel('Claude reply').fill(reply);
    await page.getByRole('button', { name: 'Preview changes' }).click();
  }
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const applied = await carBal();
  check('Apply updates the Funds screen', applied !== before, `${before} → ${applied}`);
  await page.getByRole('button', { name: 'Undo' }).click();
  check('Undo restores it', (await carBal()) === before, before);

  await page.getByRole('button', { name: 'Paste Claude\'s changes' }).click();
  await page.getByRole('alert').first().waitFor({ timeout: 3000 }).catch(() => {});
  check('Bad paste shows a clear error', (await page.getByRole('alert').count()) > 0, await page.getByRole('alert').first().innerText().catch(() => 'none'));
  check('Never contacts any AI API', !requests.some((u) => /anthropic/.test(u)));
  check('No CSP violations or page errors', bad.length === 0, bad.join(' | '));
  await page.setViewportSize({ width: 360, height: 800 });
  check('No horizontal scroll at 360px', !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)));
} catch (e) { check('ask e2e', false, String(e.message).split('\n')[0]); await page.screenshot({ path: 'out/ask-failure.png' }); }
await browser.close();
process.exit(results.every(Boolean) ? 0 : 1);

# Good morning — two minutes on your phone

**Live app:** https://yoomom.github.io/money-tracker/

1. Open this link (name, description, account, 365-day expiry and Contents read/write are already filled in):
   https://github.com/settings/personal-access-tokens/new?name=money-tracker-phone&description=Money%20Tracker%20app%3A%20read%2Fwrite%20money-data%20only&target_name=yoomom&expires_in=365&contents=write
2. Under **Repository access**, choose **Only select repositories** → `money-data`. This one can't be pre-filled.
3. Tap **Generate token**, then copy it.
4. Open https://yoomom.github.io/money-tracker/ , paste the token on the Connect screen (owner `yoomom`, repo `money-data` are prefilled) and tap **Test and save**. Your plan is already there.
5. Share → **Add to Home Screen**.
6. Add a calendar reminder for **1 Oct 2027** to renew the token.

## What happened overnight

- Seed source: **section 8 seed JSON**. `Budgeting - Money Plan.xlsx` wasn't on this Mac; the only workbook found (`~/Downloads/Budgeting.xlsx`) is the older "Actual Budgeting" layout, which needs manual duplicate resolution, so the seed was used. You can still tap **Plan → Import from Excel** any time.
- Seeded `money-data` (private) with `config.json` and `months/2026-10.json`. Totals matched the spec's expected results (planned = take-home, unallocated RM0.00, EF target, fixed total, savings rate 22.6%).
- Tests: 35 passing in CI; failing tests block deploy. Live site returned HTTP 200.

### Live end-to-end check (Playwright, 375×812, against the live site)

| Check | Result |
|---|---|
| Connect → Month shows status + 12 tiles | PASS ("Needs attention": emergency fund is below target, as expected) |
| Payday: tick, then untick | PASS |
| Log RM1 surprise from Gifts & family, fund drops by RM1, delete it | PASS |
| Funds: gifts balance back to previous value | PASS |
| Commits appeared in `money-data` | PASS (autosave batches edits into one commit) |
| Reload offline: opens with cached data | PASS |
| No horizontal scroll at 360px | PASS |
| Screenshots (demo data only) | saved in `docs/screenshots/` |
| `money-data` left identical to the seed | PASS |

### Needs your call

- One real emergency-fund balance figure sits in an early commit of the public `money-tracker` repo history (a test number; fixed in the current code). Removing it needs a history rewrite and force-push, which was blocked, so I left it. Details in `SETUP-REPORT.md`.
- The test token was only used from the environment during the check, never stored; browser storage was cleared afterwards.

---

# Update 2: talk to Claude about your money (subscription only, no API key, no extra cost)

Update 1 (the API-key chat) was removed. Nothing in the app calls any AI service; a CI check enforces it.

## What was built

**Ask Claude tab (live now, nothing to set up):** type or tap a question, tap **Ask Claude**. The app packs the coach instructions, a compact snapshot of your data and your question, copies it, and opens claude.ai (on a Mac with Claude Desktop it opens a `claude://` link instead). Paste, send. If Claude ends with a `money-changes` block, copy the reply and tap **Paste Claude's changes**: you get a before/after preview, then **Apply** or **Dismiss**, and **Undo** afterwards (also under Recent changes). Nothing leaves your device except via your clipboard.

**Money connector (built, not deployed):** a Cloudflare Worker in `money-mcp` (private repo `Yoomom/money-mcp`) so the Claude app itself (phone or Mac) can read and update your data. GitHub login, only `yoomom` allowed. It reads and writes `money-data` through its own token, commits as `claude-app: …`, and has `undo_last_change` (last 20) plus `coach`, `monthly_review` and `can_i_afford` prompts.

| Check | Result |
|---|---|
| Unit tests in the app (snapshot size and no secrets, tools, parsing valid/invalid/missing blocks, validate, apply, undo, prompt pasted back by mistake is harmless, no AI-API strings in src) | PASS (51) |
| Browser flow at 375×812: Ask → clipboard has coach prompt, data, schema and question → claude.ai opens → paste a reply → preview → Apply changes Funds → Undo restores | PASS |
| Bad paste shows a clear error; no CSP violations; no horizontal scroll at 360px; no request to any AI API | PASS |
| Connector unit tests against a fake GitHub (8): tools, reads, direct write with a `claude-app:` commit, undo stack, balance rule, sha-conflict retry, prompts, owner-only check | PASS |
| MCP Inspector CLI against a local fake repo: list 15 tools, `get_overview`, `log_surprise`, `undo_last_change` | PASS |
| `wrangler dev`: unauthenticated `/mcp` returns 401, OAuth discovery, client registration and the consent page work; `wrangler deploy --dry-run` bundles | PASS |
| Deployed to Cloudflare | **No**: `npx wrangler whoami` says not logged in |

## Your steps (connector, about 10 minutes, once, optional)

1. In a terminal: `cd ~/Repositories/Financial\ Planner/money-mcp && npm run go-live`
   - It opens the Cloudflare login (free account, no card), deploys, and prints your Worker URL `https://money-mcp.<subdomain>.workers.dev`.
2. It then opens GitHub's new OAuth App page. Homepage = the Worker URL, callback = `<Worker URL>/callback` (the script prints both). Create it, generate a client secret, and paste the ID and secret into the script when asked.
3. Create a token for the connector the same way as the phone one (only `money-data`, Contents read and write; 1 year) using the link in step 1 above, and paste it into the script. It sets the three secrets for you.
4. claude.ai (or the app) → Settings → Connectors → **Add custom connector** → name `Money`, URL `<Worker URL>/mcp` → sign in with GitHub as `yoomom`. It then appears in the phone app too.
5. Optional: create a Claude Project "Money coach" and paste this as its instructions (or just use the connector's `coach` prompt):

~~~
You are Shaq's money coach. His money tracker is connected as the "Money Tracker" connector. Currency is Malaysian ringgit (RM). Think in a Malaysian context: EPF, ASB/ASNB, PTPTN, LHDN reliefs.

How he manages money (the tracker already encodes this):
- Every ringgit has a job: the plan sums to take-home and one "remainder" item absorbs the difference.
- Sinking funds come before ASB. The emergency fund target is efTargetMonths x fixed needs. Real emergencies only, refilled next month.
- Creator and freelance income follows Profit First after giving: owner pay 50%, opex 30%, tax 15%, profit 5%.
- Giving is a fixed % of income, done first.
- Before any quit or go-full-time decision: runway of 12+ months of costs and creator income at 60%+ of take-home for 6 straight months. The quit gate is informational, never a verdict.
- Every big surprise expense records where the money came from.

How to answer:
- Start with get_overview, then use the other tools for detail. Use only numbers from tool results. If something is missing, say so and ask. Never invent balances or dates.
- For affordability questions, use simulate_purchase and show the maths: which fund pays, balance before and after, emergency-fund months, any health check that changes.
- For spending or life decisions, also ask briefly about context the numbers cannot show (upcoming expenses, cash-flow timing, plans). Give a clear recommendation, then the question.
- Keep it concise: short paragraphs, small tables only when comparing.
- Write tools (log_surprise, update_item_rule, move_between_funds, and so on) save to his data straight away after the Claude app's approval prompt. Say what you are about to change before calling one, and mention undo_last_change exists. Do not make changes he did not ask for.
- You are not a licensed financial adviser. Say so once per thread, only when giving investment-type views.
~~~

Add a calendar reminder to renew this second token in a year as well.

## Notes
- The website's Ask Claude and the connector both work on the same `money-data`. Commit messages start with `ask:` (website) and `claude-app:` (connector).
- The earlier note about one real balance figure in the public repo's early history still stands.

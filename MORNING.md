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

# Update 1: Ask chat and Claude app connector

## What was built and checked

**Ask tab (live now, needs your API key):** a 5th tab. Claude Sonnet 5.5 at medium effort answers from your real plan, funds, months and health checks, using tools to look things up. It can propose changes (log a surprise, change a rule, move money between funds, tick a payday item, record income, add a note). Each shows a before/after card with **Apply** / **Dismiss**, and **Undo** after applying. Chats are saved to `money-data/chats/`. Cost is shown under each answer, and there is a monthly cap (default US$5).

| Check | Result |
|---|---|
| Unit tests (snapshot has no secrets and is far under 60k tokens, every tool, apply/undo, balanced-plan rule, cost maths, SSE parsing, tool loop) | PASS (50 in the app) |
| Browser flow at 375×812 with a mocked AI: quick prompt → tool chip → answer → proposal card → Apply changes Funds → Undo restores | PASS |
| Send is disabled offline; no horizontal scroll at 360px; no CSP violations | PASS |
| Live regression of the original app (connect, tick, surprise, offline) after the update | PASS |
| Live call to the Claude API | **Not run**: no `ANTHROPIC_API_KEY` on this Mac (never asked for one) |
| `?demo=1` Ask uses a canned conversation | yes, no real data on the public site |

**Claude app connector (built, tested, NOT deployed):** repo `Yoomom/money-mcp` (private). Tested at the MCP protocol level against an in-memory repo (6 tests: tools list, reads, direct writes with `claude-app:` commits, undo, balance rule, sha-conflict retry, owner-only check). `wrangler dev` showed the OAuth discovery, client registration and consent page working, and `wrangler deploy --dry-run` bundles. `wrangler whoami` said not logged in, so it stops here.

## Your steps

### 1. Ask tab (about 3 minutes)
1. Go to platform.claude.com → create a workspace named `money-tracker` → set a monthly spend limit (US$10 suggested) → add credits → create an API key in that workspace.
2. In the app: **Ask** tab (or Plan → Ask (Claude)) → paste the key → **Test**.
The key stays on your phone only. Each phone/browser needs it once. This is pay-per-use API billing, separate from your Claude subscription.

### 2. Claude app connector (about 10 minutes, optional)
In a terminal on the Mac, in `~/Repositories/Financial Planner/money-mcp`:
1. `npx wrangler login`
2. `npx wrangler deploy`. Note the URL `https://money-mcp.<your-subdomain>.workers.dev`.
3. GitHub → Settings → Developer settings → OAuth Apps → New OAuth App. Homepage = the Worker URL. Authorization callback URL = `<Worker URL>/callback`. Copy the Client ID, generate a Client secret.
4. `npx wrangler secret put GITHUB_CLIENT_ID` then `npx wrangler secret put GITHUB_CLIENT_SECRET` (paste when asked).
5. Create a second fine-grained token the same way as the phone one (only `money-data`, Contents: read and write), then `npx wrangler secret put GITHUB_TOKEN`.
6. In Claude (web, desktop or phone): Settings → Connectors → **Add custom connector** → paste `<Worker URL>/mcp` → sign in with GitHub as `yoomom`. Anyone else is rejected.
7. Create a Claude **Project** called "Money coach", enable the Money Tracker connector in it, and paste this as the project instructions:

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

## Needs your attention
- Ask and the connector both write to `money-data`. Commit messages start with `chat:` (website) and `claude-app:` (connector), so you can tell them apart in the repo history.
- The earlier note about one real balance figure in the public repo's early history still stands (see above).

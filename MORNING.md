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

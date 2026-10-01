# Setup report (unattended run, 2 Oct 2026)

Decisions taken without asking, and why.

| Decision | Why |
|---|---|
| Code lives in `./money-tracker`; `SPEC.md` was not saved to disk and is git-ignored anyway | Spec says to keep the real-figure spec outside the public repo |
| GitHub account used: `Yoomom` (confirmed by `gh auth status`; scopes `repo`, `workflow`) | Matches the owner in the spec (GitHub URLs are case-insensitive) |
| Both repos were new, so they were created fresh and pushed to `main` (no overwrite, no `claude-setup` branch needed) | 9.1 rule 3 |
| **Seed source: the section 8 seed JSON, not the Excel importer** | `Budgeting - Money Plan.xlsx` does not exist on this Mac. The only workbook found was `~/Downloads/Budgeting.xlsx`, the older "Actual Budgeting" layout (Format B). The importer read it correctly (salary, 50/30/20 copies skipped, PTPTN/MARA and CapCut/Terabox breakdowns preferred, AI vs Claude flagged as a possible duplicate, "Electric and Donate" flagged to split), but it cannot balance without a human resolving those flags, so 9.4 step 3 (fall back to the seed) applied. The seed matches the spec's expected totals exactly. |
| Month opened for the seed: `2026-10` | Today is in October 2026 |
| Extra sheets (e.g. July, Aug) in an old workbook are ignored with a warning | Prevents importing last month's rows as duplicates |
| `quit-gate` "neither condition" is shown grey (informational), never red | Spec says so |
| Tests set to run in CI before deploy; one CI failure (timezone-dependent date parsing in the importer) was found, fixed and redeployed | 9.3 retry loop |
| Playwright added as a dev dependency for `scripts/e2e.mjs` | 9.5 |

## Needs your decision

- **History rewrite was blocked.** While pushing the first commits I noticed one test line in an early commit of the public repo used a real emergency-fund balance as a test number. It is already replaced in the latest code, but it remains in the earlier commit's history. Rewriting history needs a force-push, which the safety layer denied, so I left it. It is a single balance figure with no name or account attached. If you want it gone: delete and recreate `money-tracker` (it has no data, only code), or ask Claude Code to rewrite history with your explicit OK.

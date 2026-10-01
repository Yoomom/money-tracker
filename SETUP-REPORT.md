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

## Update 1: Ask chat (Phase 8) and Claude app connector (Phase 9)

| Decision | Why |
|---|---|
| `output_config.effort` confirmed valid for `claude-sonnet-5-5` in the current docs, so it is sent as specified (default `medium`). The client retries once without it if the API ever rejects it. | Spec 2.2 |
| `max_tokens` is 8000, not 4000 | Thinking tokens count toward `max_tokens`; 4000 could cut an answer short |
| Thinking blocks are kept and sent back unchanged in tool loops | The API requires it when thinking is on |
| Screens live in `src/ui/` (matching the existing app), not `src/screens/` | Consistency with phases 1–7 |
| Chats are saved to `money-data/chats/YYYY-MM.json` through the same autosave/sha-retry store as other data | Spec 2.6 |
| Undo restores the files a change touched. Shown straight away, with a confirm after 30 s | Spec 2.5 |
| `index.html` has a Content-Security-Policy: `connect-src` allows only `api.github.com` and `api.anthropic.com` | Spec 2.8; verified in the browser (no violations) |
| Live Anthropic smoke test skipped | `ANTHROPIC_API_KEY` is not set on this Mac and must never be asked for |
| Phase 9 built and tested, **not deployed** | `wrangler whoami`: not authenticated |
| The Cloudflare template flag did not apply (it produced a hello-world Worker), so the connector was written directly on `workers-oauth-provider` 1.2.1 + `agents` (McpAgent) with the same OAuth shape as the template | Offline-safe, tested at protocol level |
| Only `/mcp` (streamable HTTP) is served, no `/sse` | The OAuth library requires every protected route to sit under the canonical resource path |
| The OAuth provider is built per origin on first request | The public workers.dev URL is not known until you deploy |
| Connector access is limited to GitHub login `yoomom` twice: at the OAuth callback and again when tools are registered | Spec 3 |
| `money-mcp` has its own copy of the shared code under `src/shared/` (`npm run sync` refreshes it) | Spec 3 "copied or shared" |

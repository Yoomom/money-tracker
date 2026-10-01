# Money Tracker

Phone-first PWA: "Am I on track this month?" Vite + React + TS. Data lives in a private GitHub repo (`money-data`) via the Contents API.

## Commands
- `npm run dev` — dev server; `?demo=1` loads dummy data
- `npm test` — Vitest (domain logic, importer, Ask bridge)
- `npm run build` — typecheck + production build
- `npm run lint`
- `node scripts/e2e-ask.mjs` — Ask Claude flow against `vite preview` (demo mode)
- `GH_TOKEN=$(gh auth token) node scripts/e2e.mjs` — live Playwright check + demo screenshots
- `npm run make-fixtures` — regenerate dummy xlsx fixtures
- `npm run import -- <file.xlsx>` — run the importer in Node, writes JSON to ./out/ (git-ignored)

## Rules
- PUBLIC repo: never commit real figures or tokens. Fixtures/seed.example use dummy numbers only.
- Domain logic is pure (src/domain, src/import, src/ai) and tested.
- No Anthropic API key or pay-per-use AI anywhere (CI enforces it). Claude is reached through the user's subscription: the Ask Claude clipboard bridge, and the separate `money-mcp` connector repo.
- `src/ai/{tools,snapshot,coach,changes}.ts` are shared with `money-mcp` (`npm run sync` there copies them).

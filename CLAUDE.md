# Money Tracker

Phone-first PWA: "Am I on track this month?" Vite + React + TS. Data lives in a private GitHub repo (`money-data`) via the Contents API.

## Commands
- `npm run dev` — dev server; `?demo=1` loads dummy data
- `npm test` — Vitest (domain logic, importer)
- `npm run build` — typecheck + production build
- `npm run lint`
- `npm run make-fixtures` — regenerate dummy xlsx fixtures
- `npm run import -- <file.xlsx>` — run the importer in Node, writes JSON to ./out/ (git-ignored)

## Rules
- PUBLIC repo: never commit real figures or tokens. Fixtures/seed.example use dummy numbers only.
- Domain logic is pure (src/domain, src/import) and tested.

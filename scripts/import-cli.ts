/* npm run import -- <file.xlsx>   Prints the plan and writes JSON to ./out/ (git-ignored). */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename } from 'node:path';
import { parseWorkbook, readWorkbook } from '../src/import/excel';
import { buildConfig } from '../src/import/build';
import { openMonth } from '../src/domain/month';
import { resolveAll } from '../src/domain/plan';
import { fmtRM } from '../src/domain/util';

const file = process.argv[2];
if (!file) { console.error('Usage: npm run import -- <file.xlsx>'); process.exit(2); }
const res = parseWorkbook(readWorkbook(readFileSync(file)), basename(file));
const { config, summary } = buildConfig(res.rows, res.inputs);
const amounts = resolveAll(config);

console.log(`Format ${res.format}, sheet "${res.sheet}"`);
for (const w of res.warnings) console.log(`! ${w}`);
for (const p of config.pockets) {
  console.log(`\n${p.name}`);
  for (const it of config.items.filter((i) => i.pocketId === p.id)) console.log(`  ${it.name.padEnd(36)} ${fmtRM(amounts.get(it.id) ?? 0).padStart(12)}  ${it.rule.type}${it.fundId ? ` → ${it.fundId}` : ''}`);
}
const review = res.rows.filter((r) => !r.kind);
if (review.length) console.log(`\nNEEDS REVIEW: ${review.map((r) => r.name).join(', ')}`);
const flagged = res.rows.filter((r) => r.flags.length);
if (flagged.length) console.log(`\nFLAGGED: ${flagged.map((r) => `${r.name} [${r.flags.join(',')}]`).join('; ')}`);
console.log(`\nItems ${summary.itemCount}  take-home ${fmtRM(summary.takeHome)}  planned ${fmtRM(summary.totalPlanned)}  unallocated ${fmtRM(summary.unallocated)}  fixed ${fmtRM(summary.fixed)}  EF target ${fmtRM(summary.efTarget)}  saveable=${summary.saveable}`);

mkdirSync('out/months', { recursive: true });
writeFileSync('out/config.json', JSON.stringify(config, null, 2));
const start = (res.inputs.openingDate ?? new Date().toISOString().slice(0, 10)).slice(0, 7);
writeFileSync(`out/months/${start}.json`, JSON.stringify(openMonth(config, start), null, 2));
writeFileSync('out/import-report.json', JSON.stringify({ format: res.format, sheet: res.sheet, warnings: res.warnings, summary }, null, 2));
process.exit(summary.saveable ? 0 : 1);

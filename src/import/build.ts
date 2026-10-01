import type { Config, Fund, PlanItem, Pocket, PocketKind } from '../domain/types';
import { resolveAll, kindTotal } from '../domain/plan';
import { emergencyTarget } from '../domain/funds';
import { near, round2, slug } from '../domain/util';
import { DEFAULT_CLASSIFIER, KIND_ORDER, classify, normalizeName, splitParts, type Classifier } from './classify';
import type { ImportInputs, ImportResult, ImportRow } from './excel';

export const POCKETS: Pocket[] = [
  { id: 'give', name: 'Give', kind: 'give', order: 1 },
  { id: 'fixed', name: 'Fixed needs', kind: 'fixed', order: 2 },
  { id: 'sinking', name: 'Sinking funds', kind: 'sinking', order: 3 },
  { id: 'business', name: 'Creator business', kind: 'business', order: 4 },
  { id: 'safety', name: 'Safety then wealth', kind: 'safety', order: 5 },
  { id: 'guiltfree', name: 'Guilt-free', kind: 'guiltfree', order: 6 },
];
export const KIND_LABEL: Record<PocketKind, string> = Object.fromEntries(POCKETS.map((p) => [p.kind, p.name])) as any;

export interface BuildSummary {
  takeHome: number; totalPlanned: number; unallocated: number; fixed: number; efTarget: number;
  needsReview: number; overBy: number; trims: string[]; saveable: boolean; itemCount: number;
}

const defaultOpeningDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;

/** Turn (possibly user-edited) import rows into a balanced Config. Pure. */
export function buildConfig(
  rows: ImportRow[], inputs: ImportInputs,
  opts: { existing?: Config; classifier?: Classifier } = {},
): { config: Config; summary: BuildSummary } {
  const { existing } = opts;
  const classifier = opts.classifier ?? existing?.classifier ?? DEFAULT_CLASSIFIER;
  const openingDate = inputs.openingDate ?? defaultOpeningDate();
  const taken = new Set<string>();
  const uniqueId = (base: string) => { let id = base, n = 2; while (taken.has(id)) id = `${base}-${n++}`; taken.add(id); return id; };
  const existingByName = new Map((existing?.items ?? []).map((i) => [normalizeName(i.name), i]));

  const placed = rows.filter((r) => r.kind);
  let remainderSeen = false;
  const items: PlanItem[] = placed.map((r) => {
    const prior = existingByName.get(normalizeName(r.name));
    const base = prior?.id ?? (/car\s*loan/i.test(r.name) && !taken.has('car-loan') ? 'car-loan' : slug(r.name));
    const id = uniqueId(base);
    let rule = r.rule;
    if (rule.type === 'remainder') { if (remainderSeen) rule = { type: 'fixed', rm: r.amount }; remainderSeen = true; }
    if (rule.type === 'fixed') rule = { type: 'fixed', rm: r.amount };
    return { id, pocketId: r.kind!, name: r.name, rule, ...(prior?.note ? { note: prior.note } : {}) };
  });
  if (!remainderSeen) {
    items.push({ id: uniqueId('invest'), pocketId: 'safety', name: 'Long-term investing (remainder)', rule: { type: 'remainder' } });
  }

  // funds
  const funds = new Map<string, Fund>((existing?.funds ?? []).map((f) => [f.id, f]));
  const ensure = (f: Fund) => { if (!funds.has(f.id)) funds.set(f.id, f); };
  ensure({ id: 'emergency', name: 'Emergency fund', kind: 'emergency', opening: inputs.emergencyOpening ?? 0, openingDate });
  ensure({ id: 'invest', name: 'Long-term investing', kind: 'invest', opening: 0, openingDate });
  for (const it of items) {
    if (it.pocketId === 'safety') {
      it.fundId = /emergency|asnb|asb/i.test(it.name) ? 'emergency' : 'invest';
    } else if (it.pocketId === 'sinking' || (it.pocketId === 'business' && /fund|instal|macbook/i.test(it.name))) {
      it.fundId = it.id;
      ensure({ id: it.id, name: it.name, kind: 'sinking', opening: 0, openingDate });
    }
  }

  const config: Config = {
    version: 1, currency: 'MYR',
    takeHome: inputs.takeHome, gross: existing?.gross ?? null,
    givingPct: inputs.givingPct ?? existing?.givingPct ?? 0.025,
    efTargetMonths: inputs.efTargetMonths ?? existing?.efTargetMonths ?? 6,
    pockets: POCKETS, items, funds: [...funds.values()], classifier,
  };
  const safetyTotal = kindTotal(config, 'safety');
  const runwayTarget = round2(12 * (config.takeHome - safetyTotal));
  const rw = funds.get('runway');
  const runway: Fund = rw ? { ...rw, target: runwayTarget } : { id: 'runway', name: 'Runway fund', kind: 'runway', target: runwayTarget, opening: 0, openingDate };
  funds.set('runway', runway);
  config.funds = [...funds.values()];

  const amounts = resolveAll(config);
  const remainderItem = items.find((i) => i.rule.type === 'remainder')!;
  const remainderAmt = amounts.get(remainderItem.id) ?? 0;
  const totalPlanned = round2([...amounts.values()].reduce((a, b) => a + b, 0));
  const overBy = remainderAmt < 0 ? round2(-remainderAmt) : 0;
  const trims = overBy
    ? items.filter((i) => i.rule.type !== 'remainder' && i.pocketId !== 'fixed' && i.pocketId !== 'give')
        .sort((a, b) => (amounts.get(b.id) ?? 0) - (amounts.get(a.id) ?? 0)).slice(0, 3).map((i) => `${i.name} (RM${amounts.get(i.id)})`)
    : [];
  const unallocatedAmt = round2(config.takeHome - totalPlanned);
  const needsReview = rows.filter((r) => !r.kind).length;
  const summary: BuildSummary = {
    takeHome: config.takeHome, totalPlanned, unallocated: near(unallocatedAmt, 0) ? 0 : unallocatedAmt,
    fixed: kindTotal(config, 'fixed'), efTarget: emergencyTarget(config),
    needsReview, overBy, trims, itemCount: items.length,
    saveable: needsReview === 0 && overBy === 0 && near(unallocatedAmt, 0) && config.takeHome > 0,
  };
  return { config, summary };
}

// ───────────── row editing helpers (used by the Import screen)

export const reclassify = (rows: ImportRow[], key: string, kind: PocketKind | null) =>
  rows.map((r) => (r.key === key ? { ...r, kind } : r));
export const removeRow = (rows: ImportRow[], key: string) => rows.filter((r) => r.key !== key);
export const setRowAmount = (rows: ImportRow[], key: string, amount: number) =>
  rows.map((r) => (r.key === key && r.rule.type === 'fixed' ? { ...r, amount, rule: { type: 'fixed' as const, rm: amount } } : r.key === key ? { ...r, amount } : r));

export function splitRow(rows: ImportRow[], key: string, classifier: Classifier = DEFAULT_CLASSIFIER): ImportRow[] {
  const row = rows.find((r) => r.key === key);
  const parts = row && splitParts(row.name);
  if (!row || !parts) return rows;
  const first = round2(row.amount / 2);
  const second = round2(row.amount - first);
  const mk = (name: string, amount: number, i: number): ImportRow => ({
    key: `${key}-s${i}`, name, kind: classify(name, classifier), amount, rule: { type: 'fixed', rm: amount }, flags: [],
  });
  const out: ImportRow[] = [];
  for (const r of rows) {
    if (r.key !== key) out.push(r);
    else parts.forEach((p, i) => out.push(mk(p, i === 0 ? first : second, i)));
  }
  return out;
}

export const orderedRows = (rows: ImportRow[]) =>
  [...rows].sort((a, b) => KIND_ORDER.indexOf(a.kind ?? 'fixed') - KIND_ORDER.indexOf(b.kind ?? 'fixed'));

export const importFromResult = (res: ImportResult, existing?: Config) => buildConfig(res.rows, res.inputs, { existing });

// ───────────── re-import diff

export interface ConfigDiff {
  added: string[]; removed: string[]; changed: string[]; unchanged: number;
}
export function diffConfigs(oldC: Config, newC: Config): ConfigDiff {
  const oa = resolveAll(oldC), na = resolveAll(newC);
  const byName = new Map(oldC.items.map((i) => [normalizeName(i.name), i]));
  const seen = new Set<string>();
  const d: ConfigDiff = { added: [], removed: [], changed: [], unchanged: 0 };
  for (const it of newC.items) {
    const o = byName.get(normalizeName(it.name));
    if (!o) { d.added.push(`${it.name} RM${na.get(it.id)}`); continue; }
    seen.add(o.id);
    const a = oa.get(o.id) ?? 0, b = na.get(it.id) ?? 0;
    if (!near(a, b) || o.pocketId !== it.pocketId) d.changed.push(`${it.name}: RM${a} → RM${b}${o.pocketId !== it.pocketId ? ` (${o.pocketId} → ${it.pocketId})` : ''}`);
    else d.unchanged++;
  }
  for (const o of oldC.items) if (!seen.has(o.id)) d.removed.push(`${o.name} RM${oa.get(o.id)}`);
  return d;
}

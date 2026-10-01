import * as XLSX from 'xlsx';
import type { AmountRule, PocketKind } from '../domain/types';
import { classify, DEFAULT_CLASSIFIER, isSplitCandidate, normalizeName, splitParts, stripPocketNumber, type Classifier } from './classify';
import { near, round2, sum } from '../domain/util';

export type RowFlag = 'split?' | 'duplicate?';
export interface ImportRow {
  key: string; name: string; kind: PocketKind | null; amount: number; rule: AmountRule; flags: RowFlag[];
}
export interface ImportInputs {
  takeHome: number; givingPct?: number; efTargetMonths?: number; emergencyOpening?: number; openingDate?: string;
}
export interface ImportResult {
  format: 'A' | 'B'; sheet: string; inputs: ImportInputs; rows: ImportRow[]; warnings: string[];
  remaining?: number; fileName?: string;
}

export function readWorkbook(data: ArrayBuffer | Uint8Array): XLSX.WorkBook {
  return XLSX.read(data, { type: 'array', cellFormula: true, cellDates: true });
}

type WS = XLSX.WorkSheet;
const at = (ws: WS, r: number, c: number): XLSX.CellObject | undefined => ws[XLSX.utils.encode_cell({ r, c })];
const text = (c?: XLSX.CellObject) => (c && typeof c.v === 'string' ? c.v.trim() : undefined);
const numOf = (c?: XLSX.CellObject) => (c && typeof c.v === 'number' ? c.v : undefined);
const bounds = (ws: WS) => XLSX.utils.decode_range(ws['!ref'] ?? 'A1:A1');
const addr = (r: number, c: number) => XLSX.utils.encode_cell({ r, c });
const isPureRef = (f?: string) => !!f && /^=?\s*\$?[A-Za-z]{1,3}\$?\d+\s*$/.test(f);
const IGNORE_HEADER = /yearly|% of|total|full payment|recurrence/i;
const SKIP_LABEL = /^(total|remaining|tally|note)/i;

function numberRight(ws: WS, r: number, c: number): { v: number; r: number; c: number } | undefined {
  for (let k = 1; k <= 3; k++) {
    const n = numOf(at(ws, r, c + k));
    if (n != null) return { v: n, r, c: c + k };
  }
  return undefined;
}

export function parseWorkbook(wb: XLSX.WorkBook, fileName?: string, classifier: Classifier = DEFAULT_CLASSIFIER): ImportResult {
  const res = parseFormatA(wb, classifier) ?? parseFormatB(wb, classifier);
  return { ...res, fileName };
}

// ───────────────────────── rules

function ruleFor(label: string, cell: XLSX.CellObject, ctx: { takeHomeAddr?: string; takeHome: number; givingPct?: number }): AmountRule {
  const v = typeof cell.v === 'number' ? cell.v : 0;
  const f = (cell.f ?? '').replace(/\$/g, '').replace(/\s+/g, '').toUpperCase();
  if (f) {
    if (ctx.takeHomeAddr && (f.startsWith(`${ctx.takeHomeAddr}-`) || f.startsWith(`${ctx.takeHomeAddr}-SUM(`))) return { type: 'remainder' };
    if (/\/12\)?$/.test(f)) return { type: 'yearly', rmPerYear: round2(v * 12) };
    if (ctx.takeHomeAddr && f.includes(ctx.takeHomeAddr) && f.includes('*') && ctx.takeHome > 0) return { type: 'percentOfIncome', pct: round2(v / ctx.takeHome * 1e4) / 1e4 };
  }
  if (/remainder/i.test(label)) return { type: 'remainder' };
  if (ctx.givingPct && /%|charity/i.test(label)) return { type: 'percentOfIncome', pct: ctx.givingPct };
  return { type: 'fixed', rm: round2(v) };
}

// ───────────────────────── Format A

function parseFormatA(wb: XLSX.WorkBook, classifier: Classifier): Omit<ImportResult, 'fileName'> | null {
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    const b = bounds(ws);
    let hr = -1, pc = -1, ic = -1, ac = -1;
    for (let r = b.s.r; r <= b.e.r && hr < 0; r++) {
      let p = -1, i = -1, a = -1;
      for (let c = b.s.c; c <= b.e.c; c++) {
        const t = text(at(ws, r, c));
        if (!t) continue;
        if (/^pocket$/i.test(t)) p = c;
        else if (/^item$/i.test(t)) i = c;
        else if (/^planned/i.test(t)) a = c;
      }
      if (p >= 0 && i >= 0 && a >= 0) { hr = r; pc = p; ic = i; ac = a; }
    }
    if (hr < 0) continue;

    const inputs: ImportInputs = { takeHome: 0 };
    let takeHomeAddr: string | undefined;
    const warnings: string[] = [];
    for (let r = b.s.r; r < hr; r++) {
      for (let c = b.s.c; c <= b.e.c; c++) {
        const label = text(at(ws, r, c));
        if (!label) continue;
        const v = at(ws, r, c + 1);
        if (!v) continue;
        if (/take.?home/i.test(label) && typeof v.v === 'number') { inputs.takeHome = v.v; takeHomeAddr = addr(r, c + 1); }
        else if (/giving\s*%/i.test(label) && typeof v.v === 'number') inputs.givingPct = v.v > 1 ? v.v / 100 : v.v;
        else if (/emergency fund target/i.test(label) && typeof v.v === 'number') inputs.efTargetMonths = v.v;
        else if (/emergency fund balance/i.test(label) && typeof v.v === 'number') inputs.emergencyOpening = v.v;
        else if (/plan start/i.test(label)) {
          if (v.v instanceof Date) inputs.openingDate = `${v.v.getFullYear()}-${String(v.v.getMonth() + 1).padStart(2, '0')}-01`;
          else if (typeof v.v === 'string') { const d = new Date(`1 ${v.v}`); if (!isNaN(+d)) inputs.openingDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`; }
        }
      }
    }
    if (!inputs.takeHome) warnings.push('Could not find "Take-home salary (RM)" above the table.');

    const rows: ImportRow[] = [];
    let pocket = '';
    for (let r = hr + 1; r <= b.e.r; r++) {
      const item = text(at(ws, r, ic));
      const pk = text(at(ws, r, pc));
      if (pk) pocket = stripPocketNumber(pk);
      if (!item) continue;
      if (/^total$/i.test(item)) break;
      const cell = at(ws, r, ac);
      if (!cell || typeof cell.v !== 'number') continue;
      const rule = ruleFor(item, cell, { takeHomeAddr, takeHome: inputs.takeHome, givingPct: inputs.givingPct });
      const kind = classify(pocket, classifier) ?? classify(item, classifier);
      rows.push({ key: `r${r}`, name: item, kind, amount: round2(cell.v), rule, flags: isSplitCandidate(item, classifier) ? ['split?'] : [] });
    }
    return { format: 'A', sheet: name, inputs, rows, warnings };
  }
  return null;
}

// ───────────────────────── Format B

interface Pair { label: string; cell: XLSX.CellObject; r: number; c: number }

function scanSheetB(ws: WS) {
  const b = bounds(ws);
  let salary: { v: number; r: number; c: number } | undefined;
  let remaining: number | undefined;
  const pairs: Pair[] = [];
  for (let r = b.s.r; r <= b.e.r; r++) {
    for (let c = b.s.c; c <= b.e.c; c++) {
      const t = text(at(ws, r, c));
      if (!t) continue;
      if (!salary && /nett? salary|take.?home/i.test(t)) salary = numberRight(ws, r, c);
      else if (remaining == null && /^remaining/i.test(t)) remaining = numberRight(ws, r, c)?.v;
    }
  }
  for (let r = b.s.r; r <= b.e.r; r++) {
    for (let c = b.s.c; c <= b.e.c; c++) {
      const h = text(at(ws, r, c));
      if (!h || !/^(item|pocket|category)$/i.test(h)) continue;
      let ac = -1;
      for (let k = 1; k <= 3 && ac < 0; k++) {
        const ht = text(at(ws, r, c + k));
        if (ht && /amount|planned/i.test(ht) && !IGNORE_HEADER.test(ht)) ac = c + k;
      }
      if (ac < 0) continue;
      for (let rr = r + 1; rr <= b.e.r; rr++) {
        const label = text(at(ws, rr, c));
        if (!label || SKIP_LABEL.test(label)) break;
        const cell = at(ws, rr, ac);
        if (!cell || typeof cell.v !== 'number' || cell.v <= 0) continue;
        if (isPureRef(cell.f)) continue;
        pairs.push({ label, cell, r: rr, c });
      }
    }
  }
  return { salary, remaining, pairs };
}

function parseFormatB(wb: XLSX.WorkBook, classifier: Classifier): Omit<ImportResult, 'fileName'> {
  const scans = wb.SheetNames.map((n) => ({ name: n, ...scanSheetB(wb.Sheets[n]) })).filter((s) => s.salary && s.pairs.length);
  if (!scans.length) {
    return { format: 'B', sheet: wb.SheetNames[0] ?? '', inputs: { takeHome: 0 }, rows: [], warnings: ['No salary label and amount pairs found in this workbook.'] };
  }
  const best = scans.find((s) => /actual/i.test(s.name)) ?? [...scans].sort((a, b) => b.pairs.length - a.pairs.length)[0];
  const warnings: string[] = [];
  const others = wb.SheetNames.filter((n) => n !== best.name);
  if (others.length) warnings.push(`Only the "${best.name}" sheet was imported. Ignored: ${others.join(', ')}.`);
  const takeHome = best.salary!.v;
  const takeHomeAddr = addr(best.salary!.r, best.salary!.c);

  // merge same label + same amount
  const merged: Pair[] = [];
  for (const p of best.pairs) {
    if (merged.some((m) => normalizeName(m.label) === normalizeName(p.label) && near(m.cell.v as number, p.cell.v as number))) continue;
    merged.push(p);
  }
  // prefer breakdowns over combined rows
  const dropped = new Set<Pair>();
  for (const p of merged) {
    const parts = splitParts(p.label);
    if (!parts) continue;
    const found = parts.map((part) => merged.find((o) => o !== p && !dropped.has(o) && normalizeName(o.label).includes(normalizeName(part))));
    if (found.every(Boolean) && near(sum(found.map((o) => o!.cell.v as number)), p.cell.v as number)) {
      dropped.add(p);
      warnings.push(`Dropped "${p.label}" because it equals ${parts.join(' + ')} listed separately.`);
    }
  }
  const kept = merged.filter((p) => !dropped.has(p));
  const rows: ImportRow[] = kept.map((p) => ({
    key: `r${p.r}c${p.c}`, name: p.label.replace(/^\((\w+)\)\s*/, '$1 ').trim(), kind: classify(p.label, classifier),
    amount: round2(p.cell.v as number), rule: ruleFor(p.label, p.cell, { takeHomeAddr, takeHome }),
    flags: isSplitCandidate(p.label, classifier) ? ['split?'] : [],
  }));
  // flag possible duplicates (same pocket + same amount); sinking funds legitimately repeat amounts
  for (const a of rows) {
    if (!a.kind || a.kind === 'sinking') continue;
    if (rows.some((o) => o !== a && o.kind === a.kind && near(o.amount, a.amount))) a.flags.push('duplicate?');
  }
  const total = round2(sum(rows.map((r) => r.amount)));
  if (best.remaining != null) {
    const expected = round2(takeHome - best.remaining);
    if (!near(total, expected)) {
      const gap = round2(total - expected);
      const likely = rows.filter((r) => r.flags.includes('duplicate?') && near(r.amount, gap)).map((r) => r.name);
      warnings.push(`Imported total is RM${total.toFixed(2)} but salary minus "Remaining" is RM${expected.toFixed(2)} (gap RM${gap.toFixed(2)}).${likely.length ? ` Likely duplicate: ${likely.join(' or ')}.` : ''}`);
    }
  }
  return { format: 'B', sheet: best.name, inputs: { takeHome }, rows, warnings, remaining: best.remaining };
}

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseWorkbook, readWorkbook } from './excel';
import { buildConfig, removeRow, reclassify, splitRow, diffConfigs } from './build';
import { classify, isSplitCandidate } from './classify';
import { resolveAll } from '../domain/plan';

const load = (f: string) => parseWorkbook(readWorkbook(readFileSync(`fixtures/${f}`)), f);

describe('classify', () => {
  it('uses whole-word matching for short keywords', () => {
    expect(classify('Car Maintainance Service')).toBe('fixed');
    expect(classify('(AI) Claude')).toBe('business');
    expect(classify('Tech fund / MacBook instalment')).toBe('business');
    expect(classify('Car wear & tear')).toBe('sinking');
    expect(classify('Mystery thing')).toBeNull();
    expect(classify('Electric and Donate')).toBe('give');
  });
  it('flags combined labels but not sinking pairs', () => {
    expect(isSplitCandidate('PTPTN & MARA')).toBe(true);
    expect(isSplitCandidate('Electric and Donate')).toBe(true);
    expect(isSplitCandidate('Car wear & tear')).toBe(false);
  });
});

describe('Format A (Money Plan)', () => {
  const res = load('money-plan.xlsx');
  const { config, summary } = buildConfig(res.rows, res.inputs);
  it('reads inputs and rows', () => {
    expect(res.format).toBe('A');
    expect(res.inputs).toMatchObject({ takeHome: 4000, givingPct: 0.025, efTargetMonths: 6, emergencyOpening: 3000, openingDate: '2026-10-01' });
    expect(res.rows).toHaveLength(13);
  });
  it('derives amount rules', () => {
    const byName = (n: string) => config.items.find((i) => i.name.startsWith(n))!;
    expect(byName('Charity').rule).toEqual({ type: 'percentOfIncome', pct: 0.025 });
    expect(byName('Car insurance').rule).toEqual({ type: 'yearly', rmPerYear: 1800 });
    expect(byName('Road tax').rule).toEqual({ type: 'yearly', rmPerYear: 90 });
    expect(byName('Car wear').rule).toEqual({ type: 'yearly', rmPerYear: 600 });
    expect(byName('Long-term').rule).toEqual({ type: 'remainder' });
    expect(config.items.find((i) => i.id === 'car-loan')).toBeTruthy();
  });
  it('balances to RM0 and sets pockets and funds', () => {
    expect(summary).toMatchObject({ unallocated: 0, saveable: true, fixed: 1327.5, needsReview: 0 });
    expect(config.items.find((i) => i.name.startsWith('Car wear'))!.pocketId).toBe('sinking');
    expect(config.items.find((i) => i.name.startsWith('Emergency'))!.fundId).toBe('emergency');
    expect(config.funds.map((f) => f.id)).toEqual(expect.arrayContaining(['emergency', 'invest', 'runway']));
    expect(config.funds.find((f) => f.id === 'emergency')!.opening).toBe(3000);
    expect(config.funds.find((f) => f.id === 'runway')!.target).toBeGreaterThan(0);
  });
});

describe('Format B (Actual Budgeting)', () => {
  const res = load('actual-budgeting.xlsx');
  const names = res.rows.map((r) => r.name);
  it('finds salary, ignores other sheets and 50/30/20 copies', () => {
    expect(res.format).toBe('B');
    expect(res.inputs.takeHome).toBe(4000);
    expect(res.sheet).toBe('Actual Budgeting');
    expect(res.warnings.join(' ')).toMatch(/Ignored: July/);
    expect(names.filter((n) => /food/i.test(n))).toHaveLength(1);
    expect(names.filter((n) => /youtube/i.test(n))).toHaveLength(1);
  });
  it('prefers breakdowns over combined rows', () => {
    expect(names).toContain('PTPTN');
    expect(names).toContain('MARA');
    expect(names).not.toContain('PTPTN & MARA');
  });
  it('resolves yearly formulas, skips rows without amounts', () => {
    expect(res.rows.find((r) => r.name === 'Car Insurance')!.rule).toEqual({ type: 'yearly', rmPerYear: 1800 });
    expect(names).not.toContain('Tires');
  });
  it('flags duplicates and split candidates; gap matches the duplicate', () => {
    expect(res.rows.find((r) => r.name === 'AI')!.flags).toContain('duplicate?');
    expect(res.rows.find((r) => r.name === 'Claude')!.flags).toContain('duplicate?');
    expect(res.rows.find((r) => r.name === 'Electric and Donate')!.flags).toContain('split?');
    expect(res.warnings.join(' ')).toMatch(/gap RM100\.00/);
  });
  it('after resolving, total = salary − remaining and everything is placed', () => {
    let rows = removeRow(res.rows, res.rows.find((r) => r.name === 'AI')!.key);
    const total = rows.reduce((a, r) => a + r.amount, 0);
    expect(total).toBeCloseTo(4000 - 769.16, 1);
    const split = splitRow(rows, rows.find((r) => r.name === 'Electric and Donate')!.key);
    expect(split.map((r) => r.name)).toEqual(expect.arrayContaining(['Electric', 'Donate']));
    expect(split.find((r) => r.name === 'Donate')!.kind).toBe('give');
    const { summary, config } = buildConfig(split, res.inputs);
    expect(summary.unallocated).toBe(0);
    expect(resolveAll(config).get(config.items.find((i) => i.rule.type === 'remainder')!.id)).toBeCloseTo(769.16, 0);
  });
  it('unclassified rows land in Needs review and block saving', () => {
    const rows = [...res.rows, { key: 'x', name: 'Mystery', kind: null, amount: 10, rule: { type: 'fixed' as const, rm: 10 }, flags: [] }];
    const { summary } = buildConfig(rows, res.inputs);
    expect(summary.needsReview).toBe(1);
    expect(summary.saveable).toBe(false);
    expect(buildConfig(reclassify(rows, 'x', 'fixed'), res.inputs).summary.needsReview).toBe(0);
  });
  it('reports when the plan is over salary', () => {
    const rows = [{ key: 'a', name: 'Big', kind: 'guiltfree' as const, amount: 5000, rule: { type: 'fixed' as const, rm: 5000 }, flags: [] }];
    const { summary } = buildConfig(rows, { takeHome: 4000 });
    expect(summary.overBy).toBe(1000);
    expect(summary.saveable).toBe(false);
  });
});

describe('re-import diff', () => {
  it('lists added, changed and removed; keeps fund balances', () => {
    const a = load('money-plan.xlsx');
    const first = buildConfig(a.rows, a.inputs).config;
    const rows2 = removeRow(a.rows, a.rows.find((r) => r.name === 'Phone bill')!.key).map((r) => (r.name === 'Petrol' ? { ...r, amount: 250, rule: { type: 'fixed' as const, rm: 250 } } : r));
    rows2.push({ key: 'n', name: 'Gym', kind: 'guiltfree', amount: 50, rule: { type: 'fixed', rm: 50 }, flags: [] });
    const next = buildConfig(rows2, a.inputs, { existing: { ...first, funds: first.funds.map((f) => (f.id === 'emergency' ? { ...f, opening: 4700 } : f)) } });
    const d = diffConfigs(first, next.config);
    expect(d.added.join()).toContain('Gym');
    expect(d.removed.join()).toContain('Phone bill');
    expect(d.changed.join()).toContain('Petrol');
    expect(next.config.funds.find((f) => f.id === 'emergency')!.opening).toBe(4700);
  });
});

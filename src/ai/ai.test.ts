import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import seed from '../seed.example.json';
import type { Config } from '../domain/types';
import { apply, emptyData, type Action, type Data } from '../storage/actions';
import { buildSnapshot, SNAPSHOT_MAX_CHARS } from './snapshot';
import { runReadTool, planWriteTool, ToolError, TOOL_DEFS, isWriteTool } from './tools';
import { applyChangeSet, buildChangeSet, extractChanges, undoChangeSet } from './changes';
import { COACH_PROMPT, CHANGES_INSTRUCTION } from './coach';
import { fundBalance } from '../domain/funds';
import { monthUnallocated } from '../domain/month';
import { packQuestion } from '../ui/AskScreen';

const TODAY = '2026-10-08';
const config = seed as unknown as Config;
const base = (): Data => apply(apply(emptyData(), { type: 'setConfig', config, message: 'x' }), { type: 'openMonth', id: '2026-10' });
const dispatcher = (s: { cur: Data }) => (a: Action) => { s.cur = apply(s.cur, a); };

describe('no API-key code anywhere in src/', () => {
  it('has no Anthropic API host or key header', () => {
    const bad = ['api.' + 'anthropic.com', 'x-api' + '-key', 'anthropic-' + 'version'];
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => { const p = join(dir, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
    for (const f of walk('src').filter((p) => /\.(ts|tsx|json|css)$/.test(p) && !p.endsWith('ai.test.ts'))) {
      const t = readFileSync(f, 'utf8');
      for (const b of bad) expect(t.includes(b), `${f} contains ${b}`).toBe(false);
    }
    expect(readFileSync('index.html', 'utf8')).not.toContain('anthropic');
  });
});

describe('snapshot', () => {
  it('is compact, secret-free and under 12,000 chars', () => {
    const s = buildSnapshot(base(), TODAY);
    expect(s.length).toBeLessThan(SNAPSHOT_MAX_CHARS);
    expect(s).not.toMatch(/github_pat|ghp_|gho_|sk-ant|apiKey|token/i);
    const j = JSON.parse(s);
    expect(j.today).toBe(TODAY);
    expect(j.health).toHaveLength(12);
    expect(j.funds).toHaveLength(config.funds.length);
  });
  it('drops the oldest months first when over budget', () => {
    let d = base();
    for (const id of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09']) d = apply(d, { type: 'openMonth', id });
    const full = JSON.parse(buildSnapshot(d, TODAY, 100000));
    const small = JSON.parse(buildSnapshot(d, TODAY, full.previousMonths.length ? JSON.stringify(full).length - 200 : 1));
    expect(full.previousMonths.length).toBe(6);
    expect(small.previousMonths.length).toBeLessThan(6);
    expect(small.previousMonths.at(-1).id).toBe(full.previousMonths.at(-1).id);
  });
  it('the packed question carries the prompt, data, schema and question', () => {
    const t = packQuestion(base(), TODAY, 'Am I on track?');
    expect(t).toContain(COACH_PROMPT.slice(0, 40));
    expect(t).toContain('"today":"2026-10-08"');
    expect(t).toContain('money-changes');
    expect(t.endsWith('Am I on track?')).toBe(true);
    expect(CHANGES_INSTRUCTION).toContain('move_between_funds');
  });
});

describe('read tools', () => {
  const d = base();
  it('month, list, balances, health, simulate', () => {
    expect((runReadTool('get_month', {}, d, TODAY) as any).id).toBe('2026-10');
    expect(() => runReadTool('get_month', { id: '2025-01' }, d, TODAY)).toThrow(ToolError);
    expect((runReadTool('list_months', {}, d, TODAY) as any[])[0].id).toBe('2026-10');
    expect((runReadTool('get_fund_balances', {}, d, TODAY) as any[]).find((f) => f.id === 'emergency').balance).toBe(3000);
    expect(runReadTool('run_health', {}, d, TODAY) as any[]).toHaveLength(12);
    const r: any = runReadTool('simulate_purchase', { rm: 800, from: 'emergency' }, d, TODAY);
    expect(r.balanceAfter).toBe(2200);
    expect(r.emergencyMonthsAfter).toBeLessThan(r.emergencyMonthsBefore);
    expect((runReadTool('simulate_purchase', { rm: 1200, from: 'instalment', months: 12 }, d, TODAY) as any).monthlyPayment).toBe(100);
  });
  it('write tools are flagged', () => {
    for (const t of TOOL_DEFS) expect(isWriteTool(t.name)).toBe(!/^(get_|list_|run_|simulate_)/.test(t.name));
  });
});

describe('write tools and the balanced-plan rule', () => {
  const d = base();
  it('validate sources and rules', () => {
    expect(() => planWriteTool('log_surprise', { date: TODAY, what: 'x', rm: 5, paidFrom: 'nope' }, d, TODAY)).toThrow(/Unknown source/);
    const ok = buildChangeSet([{ type: 'update_item_rule', itemId: 'charity', rule: { type: 'percentOfIncome', pct: 0.03 } }], d, TODAY);
    const after = ok.set!.actions.reduce(apply, d);
    expect(monthUnallocated(after.months['2026-10'], after.config!)).toBe(0);
    expect(after.config!.givingPct).toBe(0.03);
    expect(buildChangeSet([{ type: 'update_item_rule', itemId: 'food', rule: { type: 'fixed', rm: 5000 } }], d, TODAY).errors[0]).toMatch(/over take-home/);
    expect(() => planWriteTool('remove_item', { itemId: 'invest' }, d, TODAY)).toThrow(/remainder/);
    expect(() => planWriteTool('add_item', { pocketId: 'guiltfree', name: 'Gym', rule: { type: 'fixed', rm: 99999 } }, d, TODAY)).toThrow(ToolError);
  });
  it('move_between_funds, payday, note, income', () => {
    const mv = buildChangeSet([{ type: 'move_between_funds', from: 'emergency', to: 'gifts', rm: 100, reason: 'top up' }], d, TODAY).set!;
    expect(mv.actions).toHaveLength(2);
    expect(fundBalance(config.funds[2], Object.values(mv.actions.reduce(apply, d).months))).toBe(100);
    expect(planWriteTool('mark_payday_item', { itemId: 'charity', done: true }, d, TODAY).actions[0].type).toBe('tick');
    expect(planWriteTool('add_month_note', { text: 'hi' }, d, TODAY).actions[0].type).toBe('addNote');
    expect(planWriteTool('set_income', { source: 'salary', rm: 4250 }, d, TODAY).actions[0].type).toBe('setSalary');
  });
});

describe('money-changes parsing', () => {
  const block = (j: string) => `Here you go.\n\n\`\`\`money-changes\n${j}\n\`\`\`\n`;
  it('valid, invalid, missing', () => {
    const good = extractChanges(block('[{"type":"log_surprise","date":"2026-10-08","what":"Car service","rm":350,"paidFrom":"car-wear","emergency":false}]'));
    expect(good.changes).toHaveLength(1);
    expect(extractChanges(block('[{"type":')).error).toMatch(/not valid JSON/);
    expect(extractChanges(block('{"type":"x"}')).error).toMatch(/array/);
    expect(extractChanges(block('[{"nope":1}]')).error).toMatch(/type/);
    expect(extractChanges('Just a chat reply, no block.').error).toMatch(/No money-changes/);
    expect(extractChanges('[{"type":"add_month_note","text":"x"}]').changes).toHaveLength(1);
  });
  it('unknown ids and types are reported, not applied', () => {
    const r = buildChangeSet([{ type: 'log_surprise', date: TODAY, what: 'x', rm: 5, paidFrom: 'zzz' }, { type: 'nuke' }], base(), TODAY);
    expect(r.set).toBeUndefined();
    expect(r.errors).toHaveLength(2);
  });
  it('changes are validated in sequence (second sees the first)', () => {
    const r = buildChangeSet([
      { type: 'add_item', pocketId: 'guiltfree', name: 'Gym', rule: { type: 'fixed', rm: 60 } },
      { type: 'update_item_rule', itemId: 'gym', rule: { type: 'fixed', rm: 80 } },
    ], base(), TODAY);
    expect(r.errors).toEqual([]);
    expect(r.set!.summaries).toHaveLength(2);
  });
});

describe('apply and undo round trip', () => {
  it('surprise: apply changes funds, undo restores the exact data', () => {
    const st = { cur: base() };
    const before = st.cur;
    const set = buildChangeSet([{ type: 'log_surprise', date: TODAY, what: 'Car service', rm: 350, paidFrom: 'car-wear' }], st.cur, TODAY).set!;
    const applied = applyChangeSet(set, st.cur, dispatcher(st), 1000);
    expect(fundBalance(config.funds[1], Object.values(st.cur.months))).toBe(-350);
    undoChangeSet(applied, dispatcher(st));
    expect(st.cur.months['2026-10']).toEqual(before.months['2026-10']);
    expect(() => applyChangeSet(applied, st.cur, dispatcher(st))).toThrow();
  });
  it('plan change: undo restores config and month', () => {
    const st = { cur: base() };
    const before = st.cur;
    const set = buildChangeSet([{ type: 'update_item_rule', itemId: 'petrol', rule: { type: 'fixed', rm: 250 } }], st.cur, TODAY).set!;
    const applied = applyChangeSet(set, st.cur, dispatcher(st));
    expect(st.cur.config).not.toEqual(before.config);
    undoChangeSet(applied, dispatcher(st));
    expect(st.cur.config).toEqual(before.config);
    expect(st.cur.months['2026-10']).toEqual(before.months['2026-10']);
  });
  it('commit label is prefixed "ask:"', () => {
    const labels: string[] = [];
    const set = buildChangeSet([{ type: 'add_month_note', text: 'x' }], base(), TODAY).set!;
    applyChangeSet(set, base(), (a) => labels.push(a.label ?? ''));
    expect(labels[0]).toMatch(/^ask: /);
  });
});

describe('pasting the prompt back by mistake is harmless', () => {
  it('the schema example in the prompt does not validate', () => {
    const ex = extractChanges(packQuestion(base(), TODAY, 'q'));
    expect(ex.changes).toBeDefined();
    expect(buildChangeSet(ex.changes!, base(), TODAY).set).toBeUndefined();
  });
  it('uses the last block when several are present', () => {
    const t = '```money-changes\n[{"type":"add_month_note","text":"first"}]\n```\nand\n```money-changes\n[{"type":"add_month_note","text":"second"}]\n```';
    expect((extractChanges(t).changes![0] as any).text).toBe('second');
  });
});

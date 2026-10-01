/* Shared tool layer: used by the Ask tab (Phase 8) and the Claude app connector (Phase 9).
   Read tools return JSON. Write tools return a draft (summary + store actions); the caller decides whether to apply. */
import type { AmountRule, Config, Month, PlanItem } from '../domain/types';
import { apply, newId, type Action, type Data } from '../storage/actions';
import { evaluateHealth } from '../domain/health';
import { emergencyTarget, fundBalance } from '../domain/funds';
import { kindTotal, resolveAll } from '../domain/plan';
import { monthPlanned, salaryOf } from '../domain/month';
import { fmtRM, monthIdOf, round2, slug, sum } from '../domain/util';

export class ToolError extends Error {}
export interface WriteDraft { summary: string; actions: Action[] }

const str = { type: 'string' } as const;
const num = { type: 'number' } as const;
const ruleSchema = {
  type: 'object',
  description: 'fixed {type:"fixed",rm} | percentOfIncome {type:"percentOfIncome",pct:0.025 for 2.5%} | yearly {type:"yearly",rmPerYear} | remainder {type:"remainder"}',
  properties: { type: { type: 'string', enum: ['fixed', 'percentOfIncome', 'yearly', 'remainder'] }, rm: num, pct: num, rmPerYear: num },
  required: ['type'],
} as const;

export const TOOL_DEFS = [
  { name: 'get_month', description: 'Full data for one month (income, planned vs actual items, surprises, fund movements, checks). Omit id for the current month.', input_schema: { type: 'object', properties: { id: { ...str, description: 'YYYY-MM' } } } },
  { name: 'list_months', description: 'All months on file with status and planned total.', input_schema: { type: 'object', properties: {} } },
  { name: 'get_fund_balances', description: 'Balance, target and progress of every fund, optionally as of a date.', input_schema: { type: 'object', properties: { asOf: { ...str, description: 'YYYY-MM-DD' } } } },
  { name: 'run_health', description: 'The 12 health checks for a month.', input_schema: { type: 'object', properties: { monthId: str } } },
  { name: 'simulate_purchase', description: 'What-if: effect of a purchase paid from a fund, or on instalment, on funds, emergency-fund months and health checks. Nothing is saved.', input_schema: { type: 'object', properties: { rm: num, from: { ...str, description: 'a fundId, or "instalment"' }, months: { ...num, description: 'instalment length in months' } }, required: ['rm', 'from'] } },
  { name: 'log_surprise', description: 'PROPOSE logging a big surprise expense. paidFrom: a fundId, a pocketId, "surplus" or "unassigned".', input_schema: { type: 'object', properties: { date: { ...str, description: 'YYYY-MM-DD' }, what: str, rm: num, paidFrom: str, emergency: { type: 'boolean', description: 'true only for a real emergency drawn from the emergency fund' } }, required: ['date', 'what', 'rm', 'paidFrom'] } },
  { name: 'set_income', description: 'PROPOSE recording income. source "salary" replaces the month salary and rebalances %-items and the remainder.', input_schema: { type: 'object', properties: { monthId: str, source: { type: 'string', enum: ['salary', 'creator', 'freelance', 'other'] }, rm: num, date: str, stream: str }, required: ['source', 'rm'] } },
  { name: 'update_item_rule', description: 'PROPOSE changing a plan item amount rule. Rejected if it would push the remainder below 0.', input_schema: { type: 'object', properties: { itemId: str, rule: ruleSchema, applyToCurrentMonth: { type: 'boolean', description: 'default true' } }, required: ['itemId', 'rule'] } },
  { name: 'add_item', description: 'PROPOSE adding a plan item.', input_schema: { type: 'object', properties: { pocketId: str, name: str, rule: ruleSchema, fundId: str, applyToCurrentMonth: { type: 'boolean' } }, required: ['pocketId', 'name', 'rule'] } },
  { name: 'remove_item', description: 'PROPOSE removing a plan item (not the remainder item).', input_schema: { type: 'object', properties: { itemId: str, applyToCurrentMonth: { type: 'boolean' } }, required: ['itemId'] } },
  { name: 'move_between_funds', description: 'PROPOSE moving money from one fund to another.', input_schema: { type: 'object', properties: { from: str, to: str, rm: num, reason: str }, required: ['from', 'to', 'rm', 'reason'] } },
  { name: 'mark_payday_item', description: 'PROPOSE ticking or unticking a payday item, optionally with the actual amount.', input_schema: { type: 'object', properties: { monthId: str, itemId: str, done: { type: 'boolean' }, actual: num }, required: ['itemId', 'done'] } },
  { name: 'add_month_note', description: 'PROPOSE adding a note to a month.', input_schema: { type: 'object', properties: { monthId: str, text: str }, required: ['text'] } },
] as const;

export const WRITE_TOOLS = new Set(['log_surprise', 'set_income', 'update_item_rule', 'add_item', 'remove_item', 'move_between_funds', 'mark_payday_item', 'add_month_note']);
export const isWriteTool = (n: string) => WRITE_TOOLS.has(n);

// ───────────── helpers

const sortedMonths = (d: Data) => Object.values(d.months).sort((a, b) => (a.id < b.id ? -1 : 1));
const cfg = (d: Data): Config => { if (!d.config) throw new ToolError('No plan configured yet.'); return d.config; };
const needMonth = (d: Data, id: string | undefined, today: string): Month => {
  const m = d.months[id ?? monthIdOf(today)];
  if (!m) throw new ToolError(`No month ${id ?? monthIdOf(today)} on file. Known: ${Object.keys(d.months).join(', ') || 'none'}.`);
  return m;
};
const monthsAsOf = (d: Data, asOf?: string) =>
  sortedMonths(d).map((m) => (asOf ? { ...m, movements: m.movements.filter((x) => x.date <= asOf) } : m));

export function fundSummaries(d: Data, asOf?: string) {
  const c = cfg(d);
  const months = monthsAsOf(d, asOf);
  return c.funds.map((f) => {
    const balance = fundBalance(f, months);
    const target = f.kind === 'emergency' ? emergencyTarget(c) : f.target;
    return { id: f.id, name: f.name, kind: f.kind, balance, ...(target ? { target, progressPct: Math.round((balance / target) * 1000) / 10 } : {}) };
  });
}

export function healthFor(d: Data, monthId: string, closing = false) {
  const c = cfg(d);
  const m = d.months[monthId];
  if (!m) throw new ToolError(`No month ${monthId} on file.`);
  return evaluateHealth({ config: c, month: m, months: sortedMonths(d), closing });
}

export function monthSummary(c: Config, m: Month) {
  const pocketOf = (itemId: string) => c.items.find((i) => i.id === itemId)?.pocketId ?? 'safety';
  return {
    id: m.id, status: m.status,
    income: round2(sum(m.income.map((i) => i.rm))),
    pockets: c.pockets.map((p) => {
      const items = m.items.filter((i) => pocketOf(i.itemId) === p.id);
      return { pocket: p.name, planned: round2(sum(items.map((i) => i.planned))), actual: round2(sum(items.filter((i) => i.done).map((i) => i.actual ?? i.planned))) };
    }),
    surprises: m.surprises.map((s) => ({ date: s.date, what: s.what, rm: s.rm, paidFrom: s.paidFrom, emergency: s.emergency })),
    fundMovements: Object.entries(m.movements.reduce<Record<string, number>>((a, x) => ({ ...a, [x.fundId]: round2((a[x.fundId] ?? 0) + x.rm) }), {})).map(([fundId, net]) => ({ fundId, net })),
    ...(m.review ? { closingHealth: m.review.health.map((h) => `${h.id}:${h.status}`), lesson: m.review.notes } : {}),
  };
}

// ───────────── read tools

export function runReadTool(name: string, input: any, d: Data, today: string): unknown {
  const c = cfg(d);
  switch (name) {
    case 'get_month': return needMonth(d, input?.id, today);
    case 'list_months': return sortedMonths(d).map((m) => ({ id: m.id, status: m.status, salary: salaryOf(m, c.takeHome), planned: monthPlanned(m), surprises: m.surprises.length }));
    case 'get_fund_balances': return fundSummaries(d, input?.asOf);
    case 'run_health': { const id = input?.monthId ?? monthIdOf(today); return healthFor(d, id); }
    case 'simulate_purchase': return simulatePurchase(d, today, Number(input?.rm), String(input?.from), input?.months);
    default: throw new ToolError(`Unknown tool ${name}`);
  }
}

function simulatePurchase(d: Data, today: string, rm: number, from: string, months?: number) {
  const c = cfg(d);
  if (!(rm > 0)) throw new ToolError('rm must be positive');
  const m = needMonth(d, undefined, today);
  const before = healthFor(d, m.id);
  const salary = salaryOf(m, c.takeHome);
  if (from === 'instalment') {
    const n = Math.max(1, Math.round(months ?? 12));
    const pay = round2(rm / n);
    const remainderItem = c.items.find((i) => i.rule.type === 'remainder');
    const amounts = resolveAll(c, salary);
    const remainder = remainderItem ? amounts.get(remainderItem.id) ?? 0 : 0;
    const saved = kindTotal(c, 'safety', salary);
    return {
      type: 'instalment', monthlyPayment: pay, months: n,
      remainderBefore: remainder, remainderAfter: round2(remainder - pay), fitsInRemainder: remainder - pay >= 0,
      savingsRateBefore: pct(saved / salary), savingsRateAfter: pct((saved - pay) / salary),
      note: 'Payment would come out of the remainder (long-term investing) unless something else is trimmed.',
    };
  }
  const fund = c.funds.find((f) => f.id === from);
  if (!fund) throw new ToolError(`Unknown fund ${from}. Funds: ${c.funds.map((f) => f.id).join(', ')}`);
  const sim = apply(d, { type: 'logSurprise', m: m.id, s: { id: 'sim', date: today, what: 'simulated', rm, paidFrom: from, emergency: false } });
  const after = healthFor(sim, m.id);
  const fixed = kindTotal(c, 'fixed');
  const bal = fundBalance(fund, sortedMonths(d));
  return {
    type: 'fund', fund: fund.name, balanceBefore: bal, balanceAfter: round2(bal - rm), wouldGoNegative: bal - rm < 0,
    ...(fund.kind === 'emergency' ? { emergencyMonthsBefore: round2(bal / fixed), emergencyMonthsAfter: round2((bal - rm) / fixed), target: emergencyTarget(c) } : {}),
    healthChanges: after.filter((h, i) => h.status !== before[i].status).map((h) => `${h.id}: ${before.find((b) => b.id === h.id)!.status} → ${h.status}`),
  };
}
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

// ───────────── write tools → drafts

function checkRule(r: any): AmountRule {
  const ok = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  if (r?.type === 'fixed' && ok(r.rm)) return { type: 'fixed', rm: r.rm };
  if (r?.type === 'percentOfIncome' && ok(r.pct) && r.pct <= 1) return { type: 'percentOfIncome', pct: r.pct };
  if (r?.type === 'yearly' && ok(r.rmPerYear)) return { type: 'yearly', rmPerYear: r.rmPerYear };
  if (r?.type === 'remainder') return { type: 'remainder' };
  throw new ToolError('Invalid rule. Use fixed{rm}, percentOfIncome{pct as a fraction, e.g. 0.03}, yearly{rmPerYear} or remainder.');
}

/** The plan must keep exactly one remainder item and it must not go negative. */
export function assertBalanced(c: Config, takeHome = c.takeHome) {
  const rem = c.items.filter((i) => i.rule.type === 'remainder');
  if (rem.length !== 1) throw new ToolError(rem.length ? 'Only one item can take the remainder.' : 'The plan needs one remainder item to stay balanced.');
  const left = resolveAll(c, takeHome).get(rem[0].id) ?? 0;
  if (left < -0.005) throw new ToolError(`This would put the plan ${fmtRM(-left)} over take-home (remainder "${rem[0].name}" would be ${fmtRM(left)}). Trim something else first.`);
}

const needFund = (c: Config, id: string) => c.funds.find((f) => f.id === id) ?? (() => { throw new ToolError(`Unknown fund "${id}". Funds: ${c.funds.map((f) => `${f.id} (${f.name})`).join(', ')}`); })();
const needItem = (c: Config, id: string) => c.items.find((i) => i.id === id) ?? (() => { throw new ToolError(`Unknown item "${id}". Items: ${c.items.map((i) => i.id).join(', ')}`); })();
const posRm = (n: unknown) => { if (typeof n !== 'number' || !(n > 0)) throw new ToolError('rm must be a positive number'); return round2(n); };
const isoDate = (s: unknown) => { if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new ToolError('date must be YYYY-MM-DD'); return s; };

export function planWriteTool(name: string, input: any, d: Data, today: string): WriteDraft {
  const c = cfg(d);
  const cur = monthIdOf(today);
  const configChange = (next: Config, summary: string, applyNow: boolean | undefined): WriteDraft => {
    assertBalanced(next);
    const open = d.months[cur]?.status === 'open';
    return { summary, actions: [{ type: 'setConfig', config: next, message: `chat: ${summary}`, ...(applyNow !== false && open ? { applyToMonth: cur } : {}) }] };
  };

  switch (name) {
    case 'log_surprise': {
      const rm = posRm(input.rm), date = isoDate(input.date);
      const paidFrom = String(input.paidFrom);
      const known = [...c.funds.map((f) => f.id), ...c.pockets.map((p) => p.id), 'surplus', 'unassigned'];
      if (!known.includes(paidFrom)) throw new ToolError(`Unknown source "${paidFrom}". Use one of: ${known.join(', ')}`);
      const mId = d.months[date.slice(0, 7)] ? date.slice(0, 7) : cur;
      needMonth(d, mId, today);
      const src = c.funds.find((f) => f.id === paidFrom)?.name ?? paidFrom;
      return { summary: `Log "${input.what}" ${fmtRM(rm)} from ${src}`, actions: [{ type: 'logSurprise', m: mId, s: { id: newId('sp'), date, what: String(input.what), rm, paidFrom, emergency: !!input.emergency } }] };
    }
    case 'set_income': {
      const mId = input.monthId ?? cur; needMonth(d, mId, today);
      const rm = posRm(input.rm);
      if (input.source === 'salary') return { summary: `Set ${mId} salary to ${fmtRM(rm)}`, actions: [{ type: 'setSalary', m: mId, rm }] };
      return { summary: `Add ${input.source} income ${fmtRM(rm)}`, actions: [{ type: 'addIncome', m: mId, entry: { id: newId('inc'), source: input.source, stream: input.stream, rm, date: input.date ?? today, split: false } }] };
    }
    case 'update_item_rule': {
      const it = needItem(c, input.itemId);
      const rule = checkRule(input.rule);
      if (rule.type === 'remainder' && c.items.some((i) => i.id !== it.id && i.rule.type === 'remainder')) throw new ToolError('Another item already takes the remainder.');
      const pocket = c.pockets.find((p) => p.id === it.pocketId);
      const next: Config = {
        ...c, items: c.items.map((i) => (i.id === it.id ? { ...i, rule } : i)),
        ...(pocket?.kind === 'give' && rule.type === 'percentOfIncome' ? { givingPct: rule.pct } : {}),
      };
      return configChange(next, `${it.name}: ${ruleText(it.rule)} → ${ruleText(rule)}`, input.applyToCurrentMonth);
    }
    case 'add_item': {
      if (!c.pockets.some((p) => p.id === input.pocketId)) throw new ToolError(`Unknown pocket. Pockets: ${c.pockets.map((p) => p.id).join(', ')}`);
      const rule = checkRule(input.rule);
      if (rule.type === 'remainder') throw new ToolError('Cannot add a second remainder item.');
      if (input.fundId) needFund(c, input.fundId);
      let id = slug(String(input.name)), n = 2;
      while (c.items.some((i) => i.id === id)) id = `${slug(String(input.name))}-${n++}`;
      const item: PlanItem = { id, pocketId: input.pocketId, name: String(input.name), rule, ...(input.fundId ? { fundId: input.fundId } : {}) };
      return configChange({ ...c, items: [...c.items, item] }, `Add "${item.name}" ${ruleText(rule)}`, input.applyToCurrentMonth);
    }
    case 'remove_item': {
      const it = needItem(c, input.itemId);
      if (it.rule.type === 'remainder') throw new ToolError('The remainder item cannot be removed.');
      return configChange({ ...c, items: c.items.filter((i) => i.id !== it.id) }, `Remove "${it.name}"`, input.applyToCurrentMonth);
    }
    case 'move_between_funds': {
      const from = needFund(c, input.from), to = needFund(c, input.to);
      if (from.id === to.id) throw new ToolError('from and to must differ');
      const rm = posRm(input.rm);
      needMonth(d, cur, today);
      const note = `Move to ${to.name}: ${input.reason}`;
      return {
        summary: `Move ${fmtRM(rm)} from ${from.name} to ${to.name}`,
        actions: [
          { type: 'adjustFund', m: cur, fundId: from.id, rm: -rm, note, date: today, id: newId('mv') },
          { type: 'adjustFund', m: cur, fundId: to.id, rm, note: `Move from ${from.name}: ${input.reason}`, date: today, id: newId('mv') },
        ],
      };
    }
    case 'mark_payday_item': {
      const mId = input.monthId ?? cur;
      const m = needMonth(d, mId, today);
      const mi = m.items.find((i) => i.itemId === input.itemId);
      if (!mi) throw new ToolError(`No payday item "${input.itemId}" in ${mId}.`);
      const label = c.items.find((i) => i.id === mi.itemId)?.name ?? mi.name ?? mi.itemId;
      if (!input.done) return { summary: `Untick "${label}"`, actions: [{ type: 'untick', m: mId, itemId: mi.itemId }] };
      const actual = input.actual != null ? posRm(input.actual) : undefined;
      return { summary: `Tick "${label}"${actual != null ? ` at ${fmtRM(actual)}` : ''}`, actions: [{ type: 'tick', m: mId, itemId: mi.itemId, actual, date: today }] };
    }
    case 'add_month_note': {
      const mId = input.monthId ?? cur; needMonth(d, mId, today);
      return { summary: `Note on ${mId}: ${String(input.text).slice(0, 60)}`, actions: [{ type: 'addNote', m: mId, id: newId('n'), date: today, text: String(input.text) }] };
    }
    default: throw new ToolError(`Unknown tool ${name}`);
  }
}

export const ruleText = (r: AmountRule) =>
  r.type === 'fixed' ? fmtRM(r.rm) : r.type === 'percentOfIncome' ? `${+(r.pct * 100).toFixed(2)}% of income` : r.type === 'yearly' ? `${fmtRM(r.rmPerYear)}/yr ÷ 12` : 'remainder';

/** Human before/after lines for a proposal: funds, health statuses and planned amounts that change. */
export function diffLines(before: Data, after: Data, today: string): string[] {
  const out: string[] = [];
  if (!before.config || !after.config) return out;
  const cur = monthIdOf(today);
  const fb = fundSummaries(before), fa = fundSummaries(after);
  fa.forEach((f, i) => { const b = fb.find((x) => x.id === f.id); if (!b) out.push(`New fund ${f.name}`); else if (Math.abs(b.balance - f.balance) > 0.004) out.push(`${f.name}: ${fmtRM(b.balance)} → ${fmtRM(f.balance)}`); void i; });
  const mb = before.months[cur], ma = after.months[cur];
  if (mb && ma) {
    for (const mi of ma.items) {
      const p = mb.items.find((x) => x.itemId === mi.itemId);
      const name = after.config.items.find((i) => i.id === mi.itemId)?.name ?? mi.name ?? mi.itemId;
      if (!p) out.push(`New this month: ${name} ${fmtRM(mi.planned)}`);
      else if (Math.abs(p.planned - mi.planned) > 0.004) out.push(`${name} (this month): ${fmtRM(p.planned)} → ${fmtRM(mi.planned)}`);
      else if (p.done !== mi.done) out.push(`${name}: ${p.done ? 'done' : 'not done'} → ${mi.done ? 'done' : 'not done'}`);
    }
    const hb = healthFor(before, cur), ha = healthFor(after, cur);
    for (const h of ha) { const o = hb.find((x) => x.id === h.id); if (o && o.status !== h.status) out.push(`Health · ${h.id}: ${o.status} → ${h.status}`); }
  }
  if (before.config !== after.config) {
    const ib = resolveAll(before.config), ia = resolveAll(after.config);
    for (const it of after.config.items) { const o = ib.get(it.id); if (o != null && Math.abs(o - (ia.get(it.id) ?? 0)) > 0.004) out.push(`Plan · ${it.name}: ${fmtRM(o)} → ${fmtRM(ia.get(it.id) ?? 0)}`); }
  }
  return out;
}

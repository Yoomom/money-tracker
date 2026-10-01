import type { Config, IncomeEntry, Month, MonthItem, Movement, Surprise } from './types';
import { resolveAll } from './plan';
import { PROFIT_FIRST } from './thresholds';
import { evaluateHealth } from './health';
import { round2, sum, uid } from './util';

export const REFILL_ID = 'refill-emergency';

export const salaryOf = (month: Month, fallback = 0) => {
  const s = month.income.filter((i) => i.source === 'salary');
  return s.length ? round2(sum(s.map((i) => i.rm))) : fallback;
};
export const totalIncome = (month: Month) => round2(sum(month.income.map((i) => i.rm)));
export const monthPlanned = (month: Month) => round2(sum(month.items.map((i) => i.planned)));
export const monthUnallocated = (month: Month, config: Config) => round2(salaryOf(month, config.takeHome) - monthPlanned(month));

export function openMonth(config: Config, id: string, prev?: Month, actualSalary?: number): Month {
  const salary = actualSalary ?? config.takeHome;
  const amounts = resolveAll(config, salary);
  const items: MonthItem[] = config.items.map((it) => ({
    itemId: it.id, planned: amounts.get(it.id) ?? 0, done: false, ...(it.fundId ? { fundId: it.fundId } : {}),
  }));
  const emergencyIds = new Set(config.funds.filter((f) => f.kind === 'emergency').map((f) => f.id));
  const withdrawn = round2(sum((prev?.surprises ?? []).filter((s) => emergencyIds.has(s.paidFrom)).map((s) => s.rm)));
  const emergencyFund = config.funds.find((f) => f.kind === 'emergency');
  let month: Month = {
    id, status: 'open',
    income: [{ id: 'salary', source: 'salary', rm: salary, date: `${id}-01` }],
    items, surprises: [], movements: [], checks: {},
  };
  if (withdrawn > 0 && emergencyFund) {
    month.items.push({
      itemId: REFILL_ID, planned: withdrawn, done: false, fundId: emergencyFund.id,
      name: 'Refill emergency fund', oneOff: true,
    });
    month = rebalance(month, config).month;
  }
  return month;
}

/** Re-resolve %-of-income and remainder items against this month's actual salary. */
export function rebalance(month: Month, config: Config): { month: Month; notice?: string } {
  const salary = salaryOf(month, config.takeHome);
  const amounts = resolveAll(config, salary);
  const remainderItem = config.items.find((i) => i.rule.type === 'remainder');
  const oneOffs = sum(month.items.filter((i) => i.oneOff).map((i) => i.planned));
  const before = new Map(month.items.map((i) => [i.itemId, i.planned]));
  const items = month.items.map((mi) => {
    const cfg = config.items.find((c) => c.id === mi.itemId);
    if (!cfg) return mi;
    if (cfg.rule.type === 'percentOfIncome') return { ...mi, planned: amounts.get(cfg.id) ?? mi.planned };
    if (cfg.rule.type === 'remainder') return { ...mi, planned: round2((amounts.get(cfg.id) ?? 0) - oneOffs) };
    return mi;
  });
  const next = { ...month, items };
  let notice: string | undefined;
  if (remainderItem) {
    const d = round2((items.find((i) => i.itemId === remainderItem.id)?.planned ?? 0) - (before.get(remainderItem.id) ?? 0));
    if (Math.abs(d) >= 0.5) {
      notice = `Plan rebalanced: ${d > 0 ? '+' : '-'}RM${Math.abs(Math.round(d)).toLocaleString('en-US')} ${d > 0 ? 'to' : 'from'} ${remainderItem.name}`;
    }
  }
  return { month: next, notice };
}

export function setSalary(month: Month, config: Config, rm: number) {
  const has = month.income.some((i) => i.source === 'salary');
  const income = has
    ? month.income.map((i, idx) => (i.source === 'salary' && idx === month.income.findIndex((x) => x.source === 'salary') ? { ...i, rm } : i))
    : [...month.income, { id: 'salary', source: 'salary' as const, rm, date: `${month.id}-01` }];
  return rebalance({ ...month, income }, config);
}

const moveFor = (month: Month, itemId: string) => month.movements.find((m) => m.refId === itemId && (m.reason === 'payday' || m.reason === 'refill'));

export function tickItem(month: Month, itemId: string, actual?: number, date = `${month.id}-01`): Month {
  const it = month.items.find((i) => i.itemId === itemId);
  if (!it) return month;
  const amount = round2(actual ?? it.actual ?? it.planned);
  const items = month.items.map((i) => (i.itemId === itemId ? { ...i, done: true, actual: actual ?? i.actual } : i));
  let movements = month.movements.filter((m) => !(m.refId === itemId && (m.reason === 'payday' || m.reason === 'refill')));
  if (it.fundId) {
    const mv: Movement = {
      id: `mv-${itemId}`, fundId: it.fundId, rm: amount,
      reason: it.oneOff ? 'refill' : 'payday', refId: itemId, date,
    };
    movements = [...movements, mv];
  }
  return { ...month, items, movements };
}

export function untickItem(month: Month, itemId: string): Month {
  return {
    ...month,
    items: month.items.map((i) => (i.itemId === itemId ? { ...i, done: false } : i)),
    movements: month.movements.filter((m) => m !== moveFor(month, itemId)),
  };
}

export function setActual(month: Month, itemId: string, actual: number | undefined): Month {
  const it = month.items.find((i) => i.itemId === itemId);
  if (!it) return month;
  const m2 = { ...month, items: month.items.map((i) => (i.itemId === itemId ? { ...i, actual } : i)) };
  return it.done ? tickItem(m2, itemId, actual) : m2;
}

export function setPlanned(month: Month, itemId: string, planned: number): Month {
  return { ...month, items: month.items.map((i) => (i.itemId === itemId ? { ...i, planned: round2(planned) } : i)) };
}

export function logSurprise(month: Month, config: Config, s: Omit<Surprise, 'id'> & { id?: string }): Month {
  const surprise: Surprise = { ...s, id: s.id ?? uid('sp') };
  const fund = config.funds.find((f) => f.id === surprise.paidFrom);
  const movements = fund
    ? [...month.movements, { id: `mv-${surprise.id}`, fundId: fund.id, rm: -surprise.rm, reason: 'surprise' as const, refId: surprise.id, date: surprise.date }]
    : month.movements;
  return { ...month, surprises: [...month.surprises, { ...surprise, emergency: fund?.kind === 'emergency' ? surprise.emergency : false }], movements };
}

export function deleteSurprise(month: Month, id: string): Month {
  return {
    ...month,
    surprises: month.surprises.filter((s) => s.id !== id),
    movements: month.movements.filter((m) => !(m.reason === 'surprise' && m.refId === id)),
  };
}

export function addManualMovement(month: Month, fundId: string, rm: number, note: string, date: string): Month {
  return { ...month, movements: [...month.movements, { id: uid('mv'), fundId, rm, reason: 'manual', date, note }] };
}

export function deleteMovement(month: Month, id: string): Month {
  return { ...month, movements: month.movements.filter((m) => m.id !== id) };
}

export interface ProfitSplit { giving: number; owner: number; opex: number; tax: number; profit: number }
export function profitFirstSplit(rm: number, givingPct: number): ProfitSplit {
  const giving = round2(rm * givingPct);
  const rest = rm - giving;
  return {
    giving,
    owner: round2(rest * PROFIT_FIRST.owner), opex: round2(rest * PROFIT_FIRST.opex),
    tax: round2(rest * PROFIT_FIRST.tax), profit: round2(rest * PROFIT_FIRST.profit),
  };
}

export function addIncome(month: Month, config: Config, entry: Omit<IncomeEntry, 'id'> & { id?: string }) {
  const e: IncomeEntry = { ...entry, id: entry.id ?? uid('inc') };
  const isBiz = e.source === 'creator' || e.source === 'freelance';
  return { month: { ...month, income: [...month.income, e] }, split: isBiz ? profitFirstSplit(e.rm, config.givingPct) : undefined };
}

export function removeIncome(month: Month, id: string): Month {
  return { ...month, income: month.income.filter((i) => i.id !== id) };
}

/** Suggested sweep: underspend on fixed + guilt-free items, minus surprises paid from 'surplus'. */
export function suggestedSweep(month: Month, config: Config): number {
  const kinds = new Map(config.pockets.map((p) => [p.id, p.kind]));
  const under = sum(
    month.items
      .filter((mi) => {
        const cfg = config.items.find((c) => c.id === mi.itemId);
        const k = cfg ? kinds.get(cfg.pocketId) : undefined;
        return (k === 'guiltfree' || k === 'fixed') && mi.done && mi.actual != null && mi.actual < mi.planned;
      })
      .map((mi) => mi.planned - (mi.actual as number)),
  );
  const fromSurplus = sum(month.surprises.filter((s) => s.paidFrom === 'surplus').map((s) => s.rm));
  return Math.max(0, round2(under - fromSurplus));
}

export function closeMonth(
  month: Month, config: Config, months: Month[],
  opts: { sweepRm?: number; sweepFundId?: string; notes?: string; closedAt?: string } = {},
): Month {
  const sweepRm = round2(opts.sweepRm ?? suggestedSweep(month, config));
  const fundId = opts.sweepFundId ?? 'emergency';
  const date = opts.closedAt ?? new Date().toISOString();
  let m: Month = { ...month };
  if (sweepRm > 0 && config.funds.some((f) => f.id === fundId)) {
    m = { ...m, movements: [...m.movements.filter((x) => x.reason !== 'sweep'), { id: `mv-sweep-${m.id}`, fundId, rm: sweepRm, reason: 'sweep', date: date.slice(0, 10) }] };
  }
  const others = months.filter((x) => x.id !== m.id);
  const health = evaluateHealth({ config, month: m, months: [...others, m], closing: true });
  return { ...m, status: 'closed', review: { notes: opts.notes ?? '', health, closedAt: date } };
}

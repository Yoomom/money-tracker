import type { Config, IncomeEntry, Month, Surprise } from '../domain/types';
import {
  addIncome, addManualMovement, closeMonth, deleteMovement, deleteSurprise, logSurprise, openMonth, rebalance,
  removeIncome, setActual, setPlanned, setSalary, tickItem, untickItem, salaryOf,
} from '../domain/month';
import { fmtRMshort, uid } from '../domain/util';

export interface Data { config: Config | null; months: Record<string, Month> }
export const emptyData = (): Data => ({ config: null, months: {} });

export type Action =
  | { type: 'setConfig'; config: Config; message: string; applyToMonth?: string }
  | { type: 'openMonth'; id: string; salary?: number }
  | { type: 'tick'; m: string; itemId: string; actual?: number; date: string }
  | { type: 'untick'; m: string; itemId: string }
  | { type: 'setActual'; m: string; itemId: string; actual?: number }
  | { type: 'setPlanned'; m: string; itemId: string; planned: number }
  | { type: 'setSalary'; m: string; rm: number }
  | { type: 'addIncome'; m: string; entry: Omit<IncomeEntry, 'id'> & { id: string } }
  | { type: 'removeIncome'; m: string; id: string }
  | { type: 'markSplit'; m: string; id: string; split: boolean }
  | { type: 'logSurprise'; m: string; s: Omit<Surprise, 'id'> & { id: string } }
  | { type: 'deleteSurprise'; m: string; id: string }
  | { type: 'adjustFund'; m: string; fundId: string; rm: number; note: string; date: string; id: string }
  | { type: 'deleteMovement'; m: string; id: string }
  | { type: 'setChecks'; m: string; checks: Month['checks'] }
  | { type: 'close'; m: string; sweepRm: number; notes: string; closedAt: string }
  | { type: 'putMonth'; month: Month };

export const newId = uid;

const prevMonth = (months: Record<string, Month>, id: string) =>
  Object.values(months).filter((m) => m.id < id).sort((a, b) => (a.id < b.id ? 1 : -1))[0];

const withMonth = (d: Data, id: string, fn: (m: Month, c: Config) => Month): Data => {
  const m = d.months[id];
  if (!m || !d.config) return d;
  return { ...d, months: { ...d.months, [id]: fn(m, d.config) } };
};

/** Re-snapshot an open month from a new config, keeping ticks/actuals for items that still exist. */
function resnapshot(m: Month, config: Config, prev?: Month): Month {
  const fresh = openMonth(config, m.id, prev, salaryOf(m, config.takeHome));
  const old = new Map(m.items.map((i) => [i.itemId, i]));
  return { ...m, items: fresh.items.map((i) => (old.has(i.itemId) ? { ...i, done: old.get(i.itemId)!.done, actual: old.get(i.itemId)!.actual } : i)) };
}

export function apply(d: Data, a: Action): Data {
  switch (a.type) {
    case 'setConfig': {
      let next: Data = { ...d, config: a.config };
      if (a.applyToMonth && next.months[a.applyToMonth]) {
        const target = a.applyToMonth;
        next = withMonth(next, target, (m, c) => resnapshot(m, c, prevMonth(d.months, target)));
      }
      return next;
    }
    case 'openMonth': {
      if (!d.config || d.months[a.id]) return d;
      return { ...d, months: { ...d.months, [a.id]: openMonth(d.config, a.id, prevMonth(d.months, a.id), a.salary) } };
    }
    case 'tick': return withMonth(d, a.m, (m) => tickItem(m, a.itemId, a.actual, a.date));
    case 'untick': return withMonth(d, a.m, (m) => untickItem(m, a.itemId));
    case 'setActual': return withMonth(d, a.m, (m) => setActual(m, a.itemId, a.actual));
    case 'setPlanned': return withMonth(d, a.m, (m) => setPlanned(m, a.itemId, a.planned));
    case 'setSalary': return withMonth(d, a.m, (m, c) => setSalary(m, c, a.rm).month);
    case 'addIncome': return withMonth(d, a.m, (m, c) => addIncome(m, c, a.entry).month);
    case 'removeIncome': return withMonth(d, a.m, (m, c) => rebalance(removeIncome(m, a.id), c).month);
    case 'markSplit': return withMonth(d, a.m, (m) => ({ ...m, income: m.income.map((i) => (i.id === a.id ? { ...i, split: a.split } : i)) }));
    case 'logSurprise': return withMonth(d, a.m, (m, c) => logSurprise(m, c, a.s));
    case 'deleteSurprise': return withMonth(d, a.m, (m) => deleteSurprise(m, a.id));
    case 'adjustFund': return withMonth(d, a.m, (m) => {
      const mm = addManualMovement(m, a.fundId, a.rm, a.note, a.date);
      const last = mm.movements[mm.movements.length - 1];
      return { ...mm, movements: [...mm.movements.slice(0, -1), { ...last, id: a.id }] };
    });
    case 'deleteMovement': return withMonth(d, a.m, (m) => deleteMovement(m, a.id));
    case 'setChecks': return withMonth(d, a.m, (m) => ({ ...m, checks: { ...m.checks, ...a.checks } }));
    case 'close': return withMonth(d, a.m, (m, c) =>
      closeMonth(m, c, Object.values(d.months), { sweepRm: a.sweepRm, notes: a.notes, closedAt: a.closedAt }));
    case 'putMonth': return { ...d, months: { ...d.months, [a.month.id]: a.month } };
    default: return d;
  }
}

/** Which JSON files an action touches. */
export function pathsOf(a: Action): string[] {
  switch (a.type) {
    case 'setConfig': return a.applyToMonth ? ['config.json', monthPath(a.applyToMonth)] : ['config.json'];
    case 'openMonth': return [monthPath(a.id)];
    case 'putMonth': return [monthPath(a.month.id)];
    default: return [monthPath(a.m)];
  }
}
export const monthPath = (id: string) => `months/${id}.json`;

export function describe(a: Action): string {
  switch (a.type) {
    case 'setConfig': return a.message;
    case 'openMonth': return `${a.id}: open month`;
    case 'tick': return `${a.m}: tick ${a.itemId}${a.actual != null ? ` RM${a.actual}` : ''}`;
    case 'untick': return `${a.m}: untick ${a.itemId}`;
    case 'setActual': return `${a.m}: actual ${a.itemId}`;
    case 'setPlanned': return `${a.m}: planned ${a.itemId}`;
    case 'setSalary': return `${a.m}: salary ${fmtRMshort(a.rm)}`;
    case 'addIncome': return `${a.m}: income ${a.entry.source} ${fmtRMshort(a.entry.rm)}`;
    case 'removeIncome': return `${a.m}: remove income`;
    case 'markSplit': return `${a.m}: income split ${a.split ? 'done' : 'undone'}`;
    case 'logSurprise': return `${a.m}: log surprise "${a.s.what}" ${fmtRMshort(a.s.rm)}`;
    case 'deleteSurprise': return `${a.m}: delete surprise`;
    case 'adjustFund': return `${a.m}: adjust ${a.fundId} ${fmtRMshort(a.rm)}`;
    case 'deleteMovement': return `${a.m}: delete movement`;
    case 'setChecks': return `${a.m}: monthly checks`;
    case 'close': return `${a.m}: close month`;
    case 'putMonth': return `${a.month.id}: restore from export`;
  }
}

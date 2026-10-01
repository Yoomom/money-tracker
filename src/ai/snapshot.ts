import type { Data } from '../storage/actions';
import { emergencyTarget } from '../domain/funds';
import { salaryOf } from '../domain/month';
import { fundSummaries, healthFor, monthSummary } from './tools';

export const SNAPSHOT_MAX_CHARS = 12000;

/** Compact data snapshot. Built only from plan and month data: it can never contain a token. */
export function buildSnapshot(d: Data, today: string, maxChars = SNAPSHOT_MAX_CHARS): string {
  const c = d.config;
  if (!c) return JSON.stringify({ today, note: 'No plan configured yet.' });
  const cur = today.slice(0, 7);
  const m = d.months[cur];
  const months = Object.values(d.months).filter((x) => x.id !== cur).sort((a, b) => (a.id < b.id ? -1 : 1)).slice(-6);
  const build = (past: typeof months) => JSON.stringify({
    today, tz: 'Asia/Kuala_Lumpur', currency: 'MYR',
    plan: {
      takeHome: c.takeHome, gross: c.gross ?? null, givingPct: c.givingPct, efTargetMonths: c.efTargetMonths, emergencyTarget: emergencyTarget(c),
      pockets: c.pockets.map((p) => [p.id, p.name, p.kind]),
      items: c.items.map((i) => [i.id, i.pocketId, i.name, i.rule, i.fundId ?? null]),
    },
    funds: fundSummaries(d).map((f) => [f.id, f.name, f.kind, f.balance, (f as any).target ?? null]),
    thisMonth: m ? {
      id: m.id, status: m.status, salary: salaryOf(m, c.takeHome),
      income: m.income.map((i) => [i.source, i.rm, i.date, i.split ?? null]),
      items: m.items.map((i) => [i.itemId, i.planned, i.actual ?? null, i.done ? 1 : 0]),
      surprises: m.surprises.map((s) => [s.date, s.what, s.rm, s.paidFrom, s.emergency ? 1 : 0]),
      checks: m.checks, notes: (m.notes ?? []).map((n) => n.text),
    } : null,
    health: m ? healthFor(d, cur).map((h) => [h.id, h.status, h.value]) : [],
    previousMonths: past.map((x) => monthSummary(c, x)),
  });
  let past = months;
  let out = build(past);
  while (out.length > maxChars && past.length) { past = past.slice(1); out = build(past); } // drop oldest first
  return out;
}

/** Today in Asia/Kuala_Lumpur as YYYY-MM-DD. */
export const todayKL = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

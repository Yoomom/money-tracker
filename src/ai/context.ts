import type { Data } from '../storage/actions';
import { emergencyTarget } from '../domain/funds';
import { fundSummaries, healthFor, monthSummary } from './tools';

/** Data snapshot sent (cached) with every call. Contains no tokens or keys: it is built only from plan and month data. */
export function buildSnapshot(d: Data, today: string): string {
  const c = d.config;
  if (!c) return JSON.stringify({ today, note: 'No plan configured yet.' });
  const { classifier, ...plan } = c;
  void classifier;
  const cur = today.slice(0, 7);
  const months = Object.values(d.months).sort((a, b) => (a.id < b.id ? -1 : 1));
  const recent = months.filter((m) => m.id !== cur).slice(-6).map((m) => monthSummary(c, m));
  const current = d.months[cur];
  return JSON.stringify({
    today, timezone: 'Asia/Kuala_Lumpur', currency: 'MYR',
    plan,
    emergencyFundTarget: emergencyTarget(c),
    fundBalances: fundSummaries(d),
    currentMonth: current ?? null,
    currentMonthHealth: current ? healthFor(d, cur) : [],
    last6MonthsSummary: recent,
  });
}

export const approxTokens = (s: string) => Math.ceil(s.length / 3.5);

/** Today in Asia/Kuala_Lumpur as YYYY-MM-DD. */
export const todayKL = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kuala_Lumpur', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

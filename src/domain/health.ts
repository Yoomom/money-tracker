import type { Config, HealthResult, Month } from './types';
import { T } from './thresholds';
import { emergencyTarget, fundBalance } from './funds';
import { kindTotal } from './plan';
import { monthUnallocated, salaryOf } from './month';
import { fmtRM, near, round2, sum, addMonths } from './util';

export interface HealthCtx {
  config: Config;
  month: Month;
  /** every month incl. the current one (for balances + quit-gate) */
  months: Month[];
  closing?: boolean;
}

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const res = (id: string, status: HealthResult['status'], value: string, why: string, source: string, info?: boolean): HealthResult =>
  ({ id, status, value, why, source, ...(info ? { info } : {}) });

export function evaluateHealth({ config, month, months, closing }: HealthCtx): HealthResult[] {
  const out: HealthResult[] = [];
  const salary = salaryOf(month, config.takeHome) || config.takeHome;
  const kindOfItem = (itemId: string) => {
    const cfg = config.items.find((c) => c.id === itemId);
    return cfg ? config.pockets.find((p) => p.id === cfg.pocketId)?.kind : undefined;
  };
  const mi = (kind: string) => month.items.filter((i) => kindOfItem(i.itemId) === kind);
  const emergencyIds = new Set(config.funds.filter((f) => f.kind === 'emergency').map((f) => f.id));

  // zero-based
  const un = monthUnallocated(month, config);
  out.push(res('zero-based', near(un, 0) ? 'green' : 'red', near(un, 0) ? 'RM0 unallocated' : `${fmtRM(un)} unallocated`, 'Every ringgit has a job', 'Sethi'));

  // given-first
  const giveItems = mi('give');
  const giveDone = giveItems.length > 0 && giveItems.every((i) => i.done);
  out.push(res('given-first', giveDone ? 'green' : closing ? 'red' : 'amber', giveDone ? 'Given' : 'Not given yet', 'Give first, fixed %', 'Ramsey step 7'));

  // savings-rate
  const saved = sum(mi('safety').map((i) => (i.done ? i.actual ?? i.planned : i.planned)));
  const rate = salary > 0 ? saved / salary : 0;
  out.push(res('savings-rate', rate >= T.savingsGreen - 1e-9 ? 'green' : rate >= T.savingsAmber ? 'amber' : 'red', pct(rate), 'Save at least 20% of take-home', 'Humphrey Yang; Ringgit Oh Ringgit'));

  // emergency-fund
  const efBal = round2(sum(config.funds.filter((f) => f.kind === 'emergency').map((f) => fundBalance(f, months))));
  const target = emergencyTarget(config);
  const fixedMonthly = kindTotal(config, 'fixed');
  const efMonths = fixedMonthly > 0 ? efBal / fixedMonthly : 0;
  out.push(res('emergency-fund', efBal >= target ? 'green' : efMonths >= T.efAmberMonths ? 'amber' : 'red', `${efMonths.toFixed(1)} of ${config.efTargetMonths} months`, '3–6 months of fixed costs as a buffer', 'Ramsey; Money Guy'));

  // fixed-costs
  const fixedRatio = salary > 0 ? kindTotal(config, 'fixed', salary) / salary : 0;
  out.push(res('fixed-costs', fixedRatio <= T.fixedGreen ? 'green' : fixedRatio <= T.fixedAmber ? 'amber' : 'red', pct(fixedRatio), 'Fixed costs 50–60% of take-home', 'Sethi'));

  // car-payment
  const car = month.items.find((i) => i.itemId === 'car-loan');
  if (!car) out.push(res('car-payment', 'green', 'No car loan', 'Car loan ≤ 8% of gross (20/3/8 rule)', 'Money Guy'));
  else if (!config.gross) out.push(res('car-payment', 'amber', 'Set gross income', 'Car loan ≤ 8% of gross (20/3/8 rule)', 'Money Guy'));
  else {
    const r = car.planned / config.gross;
    out.push(res('car-payment', r <= T.carMax ? 'green' : 'red', pct(r), 'Car loan ≤ 8% of gross (20/3/8 rule)', 'Money Guy'));
  }

  // no-raids
  const raids = month.surprises.filter((s) => emergencyIds.has(s.paidFrom) && !s.emergency);
  out.push(res('no-raids', raids.length ? 'red' : 'green', raids.length ? `${raids.length} raid${raids.length > 1 ? 's' : ''}` : 'None', 'Keep the vault for real emergencies', 'Humphrey Yang'));

  // no-leaks
  const leaks = month.surprises.filter((s) => s.paidFrom === 'unassigned');
  out.push(res('no-leaks', leaks.length ? 'red' : 'green', leaks.length ? `${leaks.length} unassigned` : 'All accounted for', 'Know where the money went', 'Vicki Robin'));

  // creator-split
  const biz = month.income.filter((i) => i.source === 'creator' || i.source === 'freelance');
  const unsplit = biz.filter((i) => !i.split);
  out.push(res('creator-split', unsplit.length ? 'red' : 'green', biz.length ? `${biz.length - unsplit.length}/${biz.length} split` : 'No creator income', 'Split business income before spending it', 'Michalowicz (Profit First)'));

  // card-paid
  const card = month.checks.cardPaidInFull;
  out.push(res('card-paid', card === true ? 'green' : card === false ? 'red' : 'amber', card === true ? 'Paid in full' : card === false ? 'Carried a balance' : 'Not answered', 'No high-interest debt', 'Money Guy step 3'));

  // life-check
  const rec = sum(mi('guiltfree').map((i) => (i.done ? i.actual ?? 0 : 0)));
  const lived = rec > 0 || month.checks.experienceLogged === true;
  out.push(res('life-check', lived ? 'green' : 'red', lived ? 'Enjoyed it' : 'Nothing yet', 'Spend on what you love', 'Sethi; Perkins'));

  // quit-gate (informational)
  const monthlyCosts = salary - kindTotal(config, 'safety', salary);
  const runwayFund = config.funds.find((f) => f.kind === 'runway');
  const runwayBal = runwayFund ? fundBalance(runwayFund, months) : 0;
  const runwayOk = runwayBal >= T.runwayMonths * monthlyCosts && monthlyCosts > 0;
  const byId = new Map(months.map((m) => [m.id, m]));
  let streak = 0;
  for (let k = 0; k < T.creatorStreakMonths; k++) {
    const m = byId.get(addMonths(month.id, -k));
    if (!m) break;
    const ms = salaryOf(m, config.takeHome) || config.takeHome;
    const creator = sum(m.income.filter((i) => i.source === 'creator').map((i) => i.rm));
    if (creator >= T.creatorShare * ms && ms > 0) streak++; else break;
  }
  const incomeOk = streak >= T.creatorStreakMonths;
  const n = Number(runwayOk) + Number(incomeOk);
  out.push(res('quit-gate', n === 2 ? 'green' : 'amber', n === 2 ? 'Gate open' : `${n}/2 conditions`, `Runway ${T.runwayMonths}× costs and creator income ≥60% for ${T.creatorStreakMonths} months`, 'QuitRunway; Justin Welsh', n < 2));

  return out;
}

export const overallStatus = (h: HealthResult[]) => {
  const reds = h.filter((x) => x.status === 'red');
  return { onTrack: reds.length === 0, reds, greens: h.filter((x) => x.status === 'green').length };
};

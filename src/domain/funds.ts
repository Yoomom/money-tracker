import type { Config, Fund, Month } from './types';
import { addMonths, round2 } from './util';
import { kindTotal } from './plan';

export const allMovements = (months: Month[]) => months.flatMap((m) => m.movements);

export function fundBalance(fund: Fund, months: Month[]): number {
  const moved = allMovements(months)
    .filter((mv) => mv.fundId === fund.id && mv.date >= fund.openingDate)
    .reduce((a, mv) => a + mv.rm, 0);
  return round2(fund.opening + moved);
}

export const fundMovements = (fund: Fund, months: Month[]) =>
  allMovements(months)
    .filter((mv) => mv.fundId === fund.id && mv.date >= fund.openingDate)
    .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

export const emergencyTarget = (config: Config) => round2(config.efTargetMonths * kindTotal(config, 'fixed'));

export function monthsToTarget(balance: number, target: number, monthlyTopUp: number): number | null {
  if (balance >= target) return 0;
  if (monthlyTopUp <= 0) return null;
  return Math.ceil((target - balance) / monthlyTopUp - 1e-9);
}

export const etaMonth = (fromMonthId: string, months: number | null) =>
  months == null ? null : addMonths(fromMonthId, months);

/** Planned monthly top-up into a fund from plan items that point at it. */
export function monthlyTopUp(config: Config, fundId: string, amounts: Map<string, number>): number {
  return round2(config.items.filter((i) => i.fundId === fundId).reduce((a, i) => a + (amounts.get(i.id) ?? 0), 0));
}

export function fundTarget(config: Config, fund: Fund): number | undefined {
  return fund.kind === 'emergency' ? emergencyTarget(config) : fund.target;
}

export type PocketKind = 'give' | 'fixed' | 'sinking' | 'business' | 'safety' | 'guiltfree';
export type AmountRule =
  | { type: 'fixed'; rm: number }
  | { type: 'percentOfIncome'; pct: number }
  | { type: 'yearly'; rmPerYear: number }
  | { type: 'remainder' };

export interface Pocket { id: string; name: string; kind: PocketKind; order: number }
export interface PlanItem {
  id: string; pocketId: string; name: string; rule: AmountRule;
  account?: string; fundId?: string; note?: string;
}
export type FundKind = 'emergency' | 'sinking' | 'runway' | 'invest';
export interface Fund {
  id: string; name: string; kind: FundKind; target?: number; opening: number; openingDate: string;
}
export interface Config {
  version: 1; currency: 'MYR';
  takeHome: number; gross?: number | null;
  givingPct: number; efTargetMonths: number;
  pockets: Pocket[]; items: PlanItem[]; funds: Fund[];
  classifier?: Record<string, string[]>;
}

export interface IncomeEntry {
  id: string; source: 'salary' | 'creator' | 'freelance' | 'other';
  stream?: string; rm: number; date: string; split?: boolean;
}
export interface MonthItem {
  itemId: string; planned: number; actual?: number; done: boolean;
  fundId?: string;
  /** one-off lines (e.g. emergency refill) are not in config */
  name?: string; pocketId?: string; oneOff?: boolean;
}
export interface Surprise {
  id: string; date: string; what: string; rm: number;
  paidFrom: string; // fundId | pocketId | 'surplus' | 'unassigned'
  emergency: boolean;
}
export interface Movement {
  id: string; fundId: string; rm: number;
  reason: 'payday' | 'surprise' | 'sweep' | 'refill' | 'manual';
  refId?: string; date: string; note?: string;
}
export interface HealthResult {
  id: string; status: 'green' | 'amber' | 'red'; value: string; why: string; source: string;
  /** informational only: render neutral, never red */
  info?: boolean;
}
export interface Month {
  id: string; status: 'open' | 'closed';
  income: IncomeEntry[]; items: MonthItem[]; surprises: Surprise[]; movements: Movement[];
  checks: { cardPaidInFull?: boolean; experienceLogged?: boolean };
  review?: { notes: string; health: HealthResult[]; closedAt: string };
}

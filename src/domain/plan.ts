import type { AmountRule, Config, PlanItem, PocketKind } from './types';
import { near, round2, sum } from './util';

/** Resolve every item's monthly amount. Remainder is computed last. */
export function resolveAll(config: Config, takeHome = config.takeHome): Map<string, number> {
  const out = new Map<string, number>();
  let remainderId: string | undefined;
  for (const it of config.items) {
    if (it.rule.type === 'remainder') { remainderId ??= it.id; continue; }
    out.set(it.id, resolveRule(it.rule, takeHome));
  }
  if (remainderId) out.set(remainderId, round2(takeHome - sum([...out.values()])));
  return out;
}

function resolveRule(rule: Exclude<AmountRule, { type: 'remainder' }>, takeHome: number): number {
  switch (rule.type) {
    case 'fixed': return round2(rule.rm);
    case 'percentOfIncome': return round2(takeHome * rule.pct);
    case 'yearly': return round2(rule.rmPerYear / 12);
  }
}

export function resolveAmount(rule: AmountRule, config: Config, takeHome = config.takeHome): number {
  if (rule.type === 'remainder') {
    const others = config.items.filter((i) => i.rule.type !== 'remainder');
    return round2(takeHome - sum(others.map((i) => resolveRule(i.rule as any, takeHome))));
  }
  return resolveRule(rule, takeHome);
}

export const plannedItems = (config: Config, takeHome = config.takeHome) => {
  const amounts = resolveAll(config, takeHome);
  return config.items.map((item) => ({ item, planned: amounts.get(item.id) ?? 0 }));
};

export function pocketTotals(config: Config, takeHome = config.takeHome): Record<string, number> {
  const t: Record<string, number> = {};
  for (const p of config.pockets) t[p.id] = 0;
  for (const { item, planned } of plannedItems(config, takeHome)) t[item.pocketId] = round2((t[item.pocketId] ?? 0) + planned);
  return t;
}

export function kindTotal(config: Config, kind: PocketKind, takeHome = config.takeHome): number {
  const totals = pocketTotals(config, takeHome);
  return round2(sum(config.pockets.filter((p) => p.kind === kind).map((p) => totals[p.id] ?? 0)));
}

export const totalPlanned = (config: Config, takeHome = config.takeHome) =>
  round2(sum(plannedItems(config, takeHome).map((x) => x.planned)));

export const unallocated = (config: Config, takeHome = config.takeHome) => {
  const u = round2(takeHome - totalPlanned(config, takeHome));
  return near(u, 0) ? 0 : u;
};

export const hasRemainder = (items: PlanItem[]) => items.some((i) => i.rule.type === 'remainder');

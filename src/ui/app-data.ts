import { useMemo } from 'react';
import { useSnap } from '../ui-kit';
import { evaluateHealth, overallStatus } from '../domain/health';
import { monthIdOf } from '../domain/util';
import type { Month } from '../domain/types';

export const HEALTH_TITLES: Record<string, string> = {
  'zero-based': 'Zero-based', 'given-first': 'Give first', 'savings-rate': 'Savings rate', 'emergency-fund': 'Emergency fund',
  'fixed-costs': 'Fixed costs', 'car-payment': 'Car payment', 'no-raids': 'No raids', 'no-leaks': 'No leaks',
  'creator-split': 'Creator split', 'card-paid': 'Card paid', 'life-check': 'Life check', 'quit-gate': 'Quit gate',
};

export function useApp() {
  const snap = useSnap();
  const { config, months } = snap.data;
  const curId = monthIdOf(new Date());
  const month: Month | undefined = months[curId];
  const all = useMemo(() => Object.values(months).sort((a, b) => (a.id < b.id ? -1 : 1)), [months]);
  const health = useMemo(
    () => (config && month ? evaluateHealth({ config, month, months: all }) : []),
    [config, month, all],
  );
  return { snap, config, months, all, curId, month, health, overall: overallStatus(health), readOnly: month?.status === 'closed' };
}

export const monthLabel = (id: string) =>
  new Date(`${id}-15T00:00:00`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });

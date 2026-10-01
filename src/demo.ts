import seed from './seed.example.json';
import type { Config } from './domain/types';
import type { Action } from './storage/actions';
import { monthIdOf } from './domain/util';

/** Dummy numbers only, for screenshots (?demo=1). */
export const demoConfig = seed as unknown as Config;
export function demoActions(): Action[] {
  const m = monthIdOf(new Date());
  const d = `${m}-03`;
  return [
    { type: 'openMonth', id: m },
    { type: 'tick', m, itemId: 'charity', date: d },
    { type: 'tick', m, itemId: 'car-loan', date: d },
    { type: 'tick', m, itemId: 'car-wear', date: d },
    { type: 'tick', m, itemId: 'ef-topup', actual: 600, date: d },
    { type: 'tick', m, itemId: 'recreation', actual: 220, date: d },
    { type: 'logSurprise', m, s: { id: 'demo-1', date: d, what: 'Car battery', rm: 150, paidFrom: 'car-wear', emergency: false } },
    { type: 'addIncome', m, entry: { id: 'demo-inc', source: 'creator', stream: 'Sponsorship', rm: 800, date: d, split: false } },
  ];
}

import { describe, expect, it } from 'vitest';
import seed from '../seed.example.json';
import type { Config } from './types';
import { resolveAll, totalPlanned, unallocated, kindTotal, resolveAmount } from './plan';
import { emergencyTarget, fundBalance, monthsToTarget, etaMonth } from './funds';
import { openMonth, setSalary, tickItem, untickItem, logSurprise, deleteSurprise, profitFirstSplit, addIncome, closeMonth, suggestedSweep, monthUnallocated, REFILL_ID, setActual } from './month';
import { evaluateHealth } from './health';

const config = seed as unknown as Config;
const find = (h: ReturnType<typeof evaluateHealth>, id: string) => h.find((x) => x.id === id)!;

describe('plan', () => {
  it('balances to zero with a remainder item', () => {
    expect(totalPlanned(config)).toBeCloseTo(4000, 2);
    expect(unallocated(config)).toBe(0);
  });
  it('resolves each rule type', () => {
    const a = resolveAll(config);
    expect(a.get('charity')).toBe(100);
    expect(a.get('car-insurance')).toBe(150);
    expect(a.get('road-tax')).toBe(7.5);
    expect(a.get('invest')).toBe(4000 - (100 + 400 + 150 + 200 + 7.5 + 70 + 500 + 50 + 100 + 150 + 300 + 600));
    expect(resolveAmount({ type: 'remainder' }, config)).toBe(a.get('invest'));
  });
  it('fixed total and emergency target', () => {
    expect(kindTotal(config, 'fixed')).toBe(1327.5);
    expect(emergencyTarget(config)).toBe(7965);
  });
});

describe('funds', () => {
  it('balance = opening + movements on/after openingDate', () => {
    const m = tickItem(openMonth(config, '2026-10'), 'ef-topup');
    const ef = config.funds[0];
    expect(fundBalance(ef, [m])).toBe(3600);
    expect(fundBalance(ef, [{ ...m, movements: [{ ...m.movements[0], date: '2026-09-01' }] }])).toBe(3000);
  });
  it('months to target + ETA', () => {
    expect(monthsToTarget(3000, 7965, 600)).toBe(9);
    expect(monthsToTarget(9000, 7965, 600)).toBe(0);
    expect(monthsToTarget(0, 10, 0)).toBeNull();
    expect(etaMonth('2026-10', 4)).toBe('2027-02');
  });
});

describe('month', () => {
  it('opens with a snapshot and salary', () => {
    const m = openMonth(config, '2026-10');
    expect(m.items).toHaveLength(config.items.length);
    expect(m.income[0].rm).toBe(4000);
    expect(monthUnallocated(m, config)).toBe(0);
  });
  it('rebalances % items and remainder when salary changes', () => {
    const { month, notice } = setSalary(openMonth(config, '2026-10'), config, 4400);
    expect(month.items.find((i) => i.itemId === 'charity')!.planned).toBe(110);
    expect(month.items.find((i) => i.itemId === 'car-loan')!.planned).toBe(400);
    expect(month.items.find((i) => i.itemId === 'invest')!.planned).toBe(1762.5);
    expect(monthUnallocated(month, config)).toBe(0);
    expect(notice).toContain('+RM');
    expect(notice).toContain('Long-term investing');
  });
  it('tick adds a payday movement and untick removes it', () => {
    let m = tickItem(openMonth(config, '2026-10'), 'gifts', 80);
    expect(m.movements).toHaveLength(1);
    expect(m.movements[0].rm).toBe(80);
    m = setActual(m, 'gifts', 90);
    expect(m.movements[0].rm).toBe(90);
    m = untickItem(m, 'gifts');
    expect(m.movements).toHaveLength(0);
    expect(m.items.find((i) => i.itemId === 'gifts')!.done).toBe(false);
  });
  it('surprise from a fund lowers it; unassigned adds no movement; delete restores', () => {
    let m = openMonth(config, '2026-10');
    m = logSurprise(m, config, { date: '2026-10-05', what: 'Battery', rm: 350, paidFrom: 'gifts', emergency: false });
    expect(fundBalance(config.funds[2], [m])).toBe(-350);
    const id = m.surprises[0].id;
    m = deleteSurprise(m, id);
    expect(fundBalance(config.funds[2], [m])).toBe(0);
    m = logSurprise(m, config, { date: '2026-10-05', what: '?', rm: 20, paidFrom: 'unassigned', emergency: false });
    expect(m.movements).toHaveLength(0);
  });
  it('emergency withdrawal creates a refill line next month', () => {
    let m = openMonth(config, '2026-10');
    m = logSurprise(m, config, { date: '2026-10-09', what: 'Hospital', rm: 800, paidFrom: 'emergency', emergency: true });
    const next = openMonth(config, '2026-11', m);
    const refill = next.items.find((i) => i.itemId === REFILL_ID)!;
    expect(refill.planned).toBe(800);
    expect(monthUnallocated(next, config)).toBe(0);
    const t = tickItem(next, REFILL_ID);
    expect(t.movements[0].reason).toBe('refill');
  });
  it('profit first split', () => {
    const s = profitFirstSplit(1000, 0.025);
    expect(s).toEqual({ giving: 25, owner: 487.5, opex: 292.5, tax: 146.25, profit: 48.75 });
    expect(addIncome(openMonth(config, '2026-10'), config, { source: 'creator', rm: 1000, date: '2026-10-10' }).split).toBeDefined();
  });
  it('close stores health, sweeps leftover and locks', () => {
    let m = openMonth(config, '2026-10');
    m = tickItem(m, 'recreation', 200);
    m = tickItem(m, 'petrol', 150);
    expect(suggestedSweep(m, config)).toBe(150);
    const closed = closeMonth(m, config, [m], { closedAt: '2026-10-31T10:00:00Z' });
    expect(closed.status).toBe('closed');
    expect(closed.review!.health).toHaveLength(12);
    expect(closed.movements.find((x) => x.reason === 'sweep')!.rm).toBe(150);
  });
});

describe('health', () => {
  const base = () => openMonth(config, '2026-10');
  it('seed month baseline', () => {
    const m = base();
    const h = evaluateHealth({ config, month: m, months: [m] });
    expect(find(h, 'zero-based').status).toBe('green');
    expect(find(h, 'savings-rate').status).toBe('green');
    expect(find(h, 'car-payment').status).toBe('amber');
    expect(find(h, 'emergency-fund').status).toBe('red');
    expect(find(h, 'no-leaks').status).toBe('green');
    expect(find(h, 'quit-gate').info).toBe(true);
  });
  it('no-leaks turns red on "not sure"', () => {
    const m = logSurprise(base(), config, { date: '2026-10-02', what: 'x', rm: 5, paidFrom: 'unassigned', emergency: false });
    expect(find(evaluateHealth({ config, month: m, months: [m] }), 'no-leaks').status).toBe('red');
  });
  it('no-raids red when emergency fund used for non-emergency', () => {
    const m = logSurprise(base(), config, { date: '2026-10-02', what: 'phone', rm: 50, paidFrom: 'emergency', emergency: false });
    expect(find(evaluateHealth({ config, month: m, months: [m] }), 'no-raids').status).toBe('red');
  });
  it('given-first, creator-split, card, life', () => {
    let m = tickItem(base(), 'charity');
    m = addIncome(m, config, { source: 'creator', rm: 500, date: '2026-10-10' }).month;
    m = { ...m, checks: { cardPaidInFull: true, experienceLogged: true } };
    const h = evaluateHealth({ config, month: m, months: [m], closing: true });
    expect(find(h, 'given-first').status).toBe('green');
    expect(find(h, 'creator-split').status).toBe('red');
    expect(find(h, 'card-paid').status).toBe('green');
    expect(find(h, 'life-check').status).toBe('green');
  });
  it('car payment against gross', () => {
    const m = base();
    expect(find(evaluateHealth({ config: { ...config, gross: 4000 }, month: m, months: [m] }), 'car-payment').status).toBe('red');
    expect(find(evaluateHealth({ config: { ...config, gross: 6000 }, month: m, months: [m] }), 'car-payment').status).toBe('green');
  });
});

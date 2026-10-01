import { cache } from '../storage/cache';

export interface Usage { input_tokens?: number; output_tokens?: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number }
/** US$ per million tokens. */
export const PRICES: Record<string, { in: number; out: number; cacheRead: number; cacheWrite: number }> = {
  'claude-sonnet-5-5': { in: 2, out: 10, cacheRead: 0.2, cacheWrite: 2.5 },
};
const FALLBACK = PRICES['claude-sonnet-5-5'];

export function usageCost(u: Usage, model = 'claude-sonnet-5-5'): number {
  const p = PRICES[model] ?? FALLBACK;
  return ((u.input_tokens ?? 0) * p.in + (u.output_tokens ?? 0) * p.out + (u.cache_read_input_tokens ?? 0) * p.cacheRead + (u.cache_creation_input_tokens ?? 0) * p.cacheWrite) / 1e6;
}
export const addUsage = (a: Usage, b: Usage): Usage => ({
  input_tokens: (a.input_tokens ?? 0) + (b.input_tokens ?? 0),
  output_tokens: (a.output_tokens ?? 0) + (b.output_tokens ?? 0),
  cache_creation_input_tokens: (a.cache_creation_input_tokens ?? 0) + (b.cache_creation_input_tokens ?? 0),
  cache_read_input_tokens: (a.cache_read_input_tokens ?? 0) + (b.cache_read_input_tokens ?? 0),
});

const k = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n));
export function costFooter(u: Usage, model?: string) {
  const usd = usageCost(u, model);
  const inAll = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  return `~US$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)} · ${k(inAll)} in / ${k(u.output_tokens ?? 0)} out`;
}

// ── monthly running total + cap (stored on this device only)
export interface Spend { month: string; usd: number }
export const currentSpendMonth = (today: string) => today.slice(0, 7);
export async function getSpend(today: string): Promise<Spend> {
  const s = (await cache.getKV<Spend>('ask-spend')) ?? { month: currentSpendMonth(today), usd: 0 };
  return s.month === currentSpendMonth(today) ? s : { month: currentSpendMonth(today), usd: 0 };
}
export async function addSpend(today: string, usd: number): Promise<Spend> {
  const s = await getSpend(today);
  const next = { ...s, usd: s.usd + usd };
  await cache.setKV('ask-spend', next);
  return next;
}
export const overCap = (spend: Spend, capUsd: number) => spend.usd >= capUsd;

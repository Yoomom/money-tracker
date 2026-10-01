export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const near = (a: number, b: number, tol = 0.01) => Math.abs(a - b) <= tol;
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

export function fmtRM(n: number): string {
  const neg = n < 0 ? '-' : '';
  const s = Math.abs(round2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${neg}RM${s}`;
}
export const fmtRMshort = (n: number) => fmtRM(n).replace(/\.00$/, '');

export const uid = (p = 'id') => `${p}-${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36).slice(-3)}`;

export function monthIdOf(date: Date | string): string {
  const s = typeof date === 'string' ? date : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  return s.slice(0, 7);
}
export function addMonths(id: string, n: number): string {
  const [y, m] = id.split('-').map(Number);
  const t = y * 12 + (m - 1) + n;
  return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`;
}
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const slug = (s: string) =>
  s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'item';

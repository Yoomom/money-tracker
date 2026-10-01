import type { PocketKind } from '../domain/types';

export type Classifier = Record<PocketKind, string[]>;

/** First match wins, in ORDER. Short keywords (≤3 chars) must match a whole word. */
export const DEFAULT_CLASSIFIER: Classifier = {
  give: ['charity', 'donat', 'sadaqah', 'zakat', 'give'],
  sinking: ['wear', 'tear', 'tyre', 'tire', 'brake', 'absorber', 'lower arm', 'gift', 'birthday', 'occasion', 'sinking'],
  business: ['youtube', 'business', 'capcut', 'terabox', 'claude', 'ai', 'co-shar', 'cowork', 'co-work', 'editor', 'growth', 'tech fund', 'macbook'],
  safety: ['safety', 'wealth', 'asnb', 'asb', 'emergency', 'saving', 'invest', 'stock', 'runway'],
  guiltfree: ['recreation', 'fun', 'entertainment', 'hobby', 'guilt'],
  fixed: ['fixed', 'need', 'loan', 'insurance', 'petrol', 'road tax', 'service', 'ptptn', 'mara', 'therapy', 'food', 'maxis', 'bill', 'electric', 'water', 'haircut', 'dad', 'family', 'phone', 'rent', 'carwash'],
};
export const KIND_ORDER: PocketKind[] = ['give', 'sinking', 'business', 'safety', 'guiltfree', 'fixed'];

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const matches = (label: string, kw: string) =>
  new RegExp(kw.length <= 3 ? `(^|[^a-z0-9])${esc(kw)}([^a-z0-9]|$)` : `(^|[^a-z0-9])${esc(kw)}`, 'i').test(label);

export function classify(label: string, classifier: Classifier = DEFAULT_CLASSIFIER): PocketKind | null {
  const l = label.toLowerCase();
  for (const kind of KIND_ORDER) if ((classifier[kind] ?? []).some((kw) => matches(l, kw.toLowerCase()))) return kind;
  return null;
}

export const normalizeName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '');

/** "PTPTN & MARA" -> ["PTPTN", "MARA"] */
export function splitParts(label: string): string[] | null {
  const parts = label.split(/\s+(?:&|and|\+)\s+|\s*\/\s*/i).map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts : null;
}

/** Combined label worth offering a split: both halves classify, and they differ in kind or are single words. */
export function isSplitCandidate(label: string, classifier: Classifier = DEFAULT_CLASSIFIER): boolean {
  if (classify(label, classifier) === 'sinking') return false;
  const parts = splitParts(label);
  if (!parts || parts.length !== 2) return false;
  const [a, b] = parts.map((p) => classify(p, classifier));
  if (!a || !b) return false;
  return a !== b || parts.every((p) => !/\s/.test(p));
}

export const stripPocketNumber = (s: string) => s.replace(/^\s*\d+\s*[.)-]\s*/, '').trim();

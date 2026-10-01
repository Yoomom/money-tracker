import { get, set, del, createStore } from 'idb-keyval';
import type { Conn } from './github';

const store = createStore('money-tracker', 'kv');
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await fn(); } catch { return fallback; }
};

export interface CachedFile { content: string; sha: string }
export type Files = Record<string, CachedFile>;

export const cache = {
  getConn: () => safe(() => get<Conn>('conn', store), undefined),
  setConn: (c: Conn) => safe(() => set('conn', c, store), undefined),
  clearConn: () => safe(() => del('conn', store), undefined),
  getFiles: () => safe(async () => (await get<Files>('files', store)) ?? {}, {} as Files),
  setFiles: (f: Files) => safe(() => set('files', f, store), undefined),
  getPending: () => safe(async () => (await get<unknown[]>('pending', store)) ?? [], [] as unknown[]),
  setPending: (p: unknown[]) => safe(() => set('pending', p, store), undefined),
  clearAll: async () => { await Promise.all(['conn', 'files', 'pending'].map((k) => safe(() => del(k, store), undefined))); },
};

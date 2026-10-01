import type { Config, Month } from '../domain/types';
import { apply, contentOf, describe, emptyData, monthPath, pathsOf, type Action, type Data } from './actions';
import { cache, type Files } from './cache';
import { AuthError, ConflictError, GitHubClient, NetworkError, type Conn } from './github';

export type SyncStatus = 'idle' | 'saving' | 'offline' | 'error' | 'conflict';
export interface Snapshot {
  ready: boolean;
  conn?: Conn;
  data: Data;
  /** true once we have asked GitHub and found no config.json */
  needsSetup: boolean;
  pendingCount: number;
  status: SyncStatus;
  error?: string;
  demo: boolean;
}

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

export class Store {
  private listeners = new Set<() => void>();
  private client?: GitHubClient;
  private base: Data = emptyData();
  private baseFiles: Files = {};
  private pending: Action[] = [];
  private flushing = false;
  private timer?: ReturnType<typeof setTimeout>;
  private snap: Snapshot = { ready: false, data: emptyData(), needsSetup: false, pendingCount: 0, status: 'idle', demo: false };

  getSnapshot = () => this.snap;
  subscribe = (fn: () => void) => { this.listeners.add(fn); return () => this.listeners.delete(fn); };
  private set(patch: Partial<Snapshot>) { this.snap = { ...this.snap, ...patch }; this.listeners.forEach((l) => l()); }

  private local(): Data { return this.pending.reduce(apply, this.base); }
  private publish(patch: Partial<Snapshot> = {}) { this.set({ data: this.local(), pendingCount: this.pending.length, ...patch }); }

  // ───────── boot

  async startDemo(seed: Config, extra: Action[] = []) {
    this.base = emptyData();
    this.base = apply(this.base, { type: 'setConfig', config: seed, message: 'demo' });
    this.pending = [];
    this.set({ demo: true, ready: true, data: this.base, status: 'idle' });
    extra.forEach((a) => this.dispatch(a));
  }

  async boot() {
    const conn = await cache.getConn();
    if (!conn) { this.set({ ready: true }); return; }
    this.baseFiles = await cache.getFiles();
    this.base = this.parseFiles(this.baseFiles);
    this.pending = (await cache.getPending()) as Action[];
    this.client = new GitHubClient(conn);
    this.publish({ ready: true, conn, needsSetup: false });
    void this.refresh();
  }

  async connect(conn: Conn): Promise<void> {
    const client = new GitHubClient(conn);
    await client.test();
    this.client = client;
    await cache.setConn(conn);
    this.baseFiles = {};
    this.base = emptyData();
    this.pending = [];
    this.set({ conn, ready: true, error: undefined });
    await this.refresh(true);
  }

  async disconnect() {
    await cache.clearAll();
    this.client = undefined; this.base = emptyData(); this.baseFiles = {}; this.pending = [];
    this.set({ conn: undefined, data: emptyData(), needsSetup: false, pendingCount: 0, status: 'idle', error: undefined });
  }

  private parseFiles(files: Files): Data {
    const d = emptyData();
    for (const [path, f] of Object.entries(files)) {
      try {
        if (path === 'config.json') d.config = JSON.parse(f.content);
        else if (path.startsWith('months/')) { const m: Month = JSON.parse(f.content); d.months[m.id] = m; }
        else if (path.startsWith('chats/')) { const c = JSON.parse(f.content); d.chats[c.id] = c; }
      } catch { /* skip unreadable file */ }
    }
    return d;
  }

  /** Pull the latest from GitHub (after pushing anything pending). */
  async refresh(first = false) {
    if (!this.client || this.snap.demo) return;
    try {
      if (this.pending.length) await this.flush();
      if (this.pending.length) return; // could not push: keep local copy
      const cfg = await this.client.getFile('config.json');
      const listing = await this.client.list('months');
      const files: Files = {};
      if (cfg) files['config.json'] = cfg;
      const chatListing = await this.client.list('chats');
      for (const f of [...listing, ...chatListing].filter((x) => /^\d{4}-\d{2}\.json$/.test(x.name))) {
        const have = this.baseFiles[f.path];
        files[f.path] = have && have.sha === f.sha ? have : (await this.client.getFile(f.path)) ?? have;
        if (!files[f.path]) delete files[f.path];
      }
      this.baseFiles = files;
      this.base = this.parseFiles(files);
      await cache.setFiles(files);
      this.publish({ needsSetup: !cfg && (first || !this.base.config), status: 'idle', error: undefined });
    } catch (e) {
      this.fail(e);
    }
  }

  private fail(e: unknown) {
    if (e instanceof NetworkError || (typeof navigator !== 'undefined' && !navigator.onLine)) this.set({ status: 'offline', error: undefined });
    else if (e instanceof ConflictError) this.set({ status: 'conflict', error: e.message });
    else if (e instanceof AuthError) this.set({ status: 'error', error: e.message });
    else this.set({ status: 'error', error: (e as Error).message });
  }

  // ───────── edits

  dispatch(a: Action) {
    this.pending.push(a);
    this.publish();
    if (this.snap.demo) { this.pending = []; this.base = this.snap.data; this.set({ pendingCount: 0 }); return; }
    void cache.setPending(this.pending);
    this.schedule();
  }

  private schedule(ms = 1500) {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), ms);
  }

  async flush(): Promise<void> {
    if (!this.client || this.flushing || !this.pending.length) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) { this.set({ status: 'offline' }); return; }
    this.flushing = true;
    this.set({ status: 'saving' });
    const batch = this.pending.slice();
    try {
      const after = batch.reduce(apply, this.base);
      const paths = [...new Set(batch.flatMap(pathsOf))];
      for (const path of paths) {
        const content = json(contentOf(after, path));
        const msgs = [...new Set(batch.filter((a) => pathsOf(a).includes(path)).map(describe))];
        const message = msgs[msgs.length - 1] + (msgs.length > 1 ? ` (+${msgs.length - 1} more)` : '');
        await this.putWithRetry(path, content, message, batch);
      }
      this.pending = this.pending.slice(batch.length);
      await cache.setPending(this.pending);
      await cache.setFiles(this.baseFiles);
      this.base = this.parseFiles(this.baseFiles);
      this.publish({ status: 'idle', error: undefined });
    } catch (e) {
      this.fail(e);
    } finally {
      this.flushing = false;
    }
    if (this.pending.length && this.snap.status === 'idle') this.schedule(300);
  }

  private async putWithRetry(path: string, content: string, message: string, batch: Action[]) {
    const client = this.client!;
    const prior = this.baseFiles[path];
    try {
      const sha = await client.putFile(path, content, message, prior?.sha);
      this.baseFiles[path] = { content, sha };
    } catch (e) {
      if (!(e instanceof ConflictError)) throw e;
      // Changed elsewhere: take the fresh copy, replay our edits on top, retry once.
      const fresh = await client.getFile(path);
      if (fresh) this.baseFiles[path] = fresh; else delete this.baseFiles[path];
      const merged = batch.reduce(apply, this.parseFiles(this.baseFiles));
      const content2 = json(contentOf(merged, path));
      const sha = await client.putFile(path, content2, message, fresh?.sha);
      this.baseFiles[path] = { content: content2, sha };
    }
  }

  /** Throw away unsynced edits and reload from GitHub. */
  async discardPendingAndReload() {
    this.pending = [];
    await cache.setPending([]);
    this.set({ status: 'idle', error: undefined });
    await this.refresh();
  }

  monthExists = (id: string) => !!this.snap.data.months[id];
  static monthPath = monthPath;
}

export const store = new Store();

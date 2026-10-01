export interface Conn { owner: string; repo: string; token: string }
export interface RemoteFile { content: string; sha: string }

export class ConflictError extends Error { constructor() { super('Changed elsewhere — reload'); } }
export class AuthError extends Error { constructor(m = 'Token rejected — check it has Contents: read and write on money-data') { super(m); } }
export class NetworkError extends Error { constructor() { super('Offline'); } }

export function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function fromBase64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

type FetchFn = typeof fetch;

export class GitHubClient {
  constructor(private conn: Conn, private fetchFn: FetchFn = (...a) => fetch(...a)) {}

  private url(path = '') {
    return `https://api.github.com/repos/${this.conn.owner}/${this.conn.repo}/contents/${path.split('/').map(encodeURIComponent).join('/')}`;
  }
  private async call(url: string, init: RequestInit = {}) {
    let res: Response;
    try {
      res = await this.fetchFn(url, {
        ...init,
        cache: 'no-store',
        headers: {
          Authorization: `Bearer ${this.conn.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
        },
      });
    } catch {
      throw new NetworkError();
    }
    if (res.status === 401 || res.status === 403) throw new AuthError();
    return res;
  }

  /** Verify the token can see the repo. */
  async test(): Promise<void> {
    const res = await this.call(`https://api.github.com/repos/${this.conn.owner}/${this.conn.repo}`);
    if (res.status === 404) throw new AuthError('Repo not found — check owner/repo, and that the token includes it');
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  }

  async getFile(path: string): Promise<RemoteFile | null> {
    const res = await this.call(this.url(path));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    const j = await res.json();
    return { content: fromBase64(j.content), sha: j.sha };
  }

  /** List file names in a directory ({name, sha}); empty if it does not exist. */
  async list(dir: string): Promise<{ name: string; path: string; sha: string }[]> {
    const res = await this.call(this.url(dir));
    if (res.status === 404) return [];
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    const j = await res.json();
    return Array.isArray(j) ? j.filter((f: any) => f.type === 'file') : [];
  }

  async putFile(path: string, content: string, message: string, sha?: string): Promise<string> {
    const res = await this.call(this.url(path), {
      method: 'PUT',
      body: JSON.stringify({ message, content: toBase64(content), ...(sha ? { sha } : {}) }),
    });
    if (res.status === 409 || res.status === 422) throw new ConflictError();
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
    const j = await res.json();
    return j.content.sha;
  }

  async deleteFile(path: string, message: string, sha: string): Promise<void> {
    const res = await this.call(this.url(path), { method: 'DELETE', body: JSON.stringify({ message, sha }) });
    if (res.status === 409 || res.status === 422) throw new ConflictError();
    if (!res.ok) throw new Error(`GitHub said ${res.status}`);
  }
}

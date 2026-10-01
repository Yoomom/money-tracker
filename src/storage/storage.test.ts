import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, ConflictError, AuthError, fromBase64, toBase64 } from './github';
import { apply, emptyData, describe as describeAction } from './actions';
import seed from '../seed.example.json';
import type { Config } from '../domain/types';

const config = seed as unknown as Config;
const res = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });

describe('base64 utf-8', () => {
  it('round-trips non-ASCII', () => {
    const s = 'Ringgit ✓ — café 日本';
    expect(fromBase64(toBase64(s))).toBe(s);
  });
});

describe('GitHubClient', () => {
  const conn = { owner: 'o', repo: 'r', token: 'tok' };
  it('sends auth headers and decodes content', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { content: toBase64('{"a":1}\n'), sha: 's1' }));
    const file = await new GitHubClient(conn, f as any).getFile('months/2026-10.json');
    expect(file).toEqual({ content: '{"a":1}\n', sha: 's1' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.github.com/repos/o/r/contents/months/2026-10.json');
    expect(init.headers.Authorization).toBe('Bearer tok');
    expect(init.headers['X-GitHub-Api-Version']).toBe('2022-11-28');
  });
  it('404 → null, 409/422 → ConflictError, 401 → AuthError', async () => {
    expect(await new GitHubClient(conn, (async () => res(404)) as any).getFile('config.json')).toBeNull();
    await expect(new GitHubClient(conn, (async () => res(409)) as any).putFile('x', 'y', 'm', 's')).rejects.toBeInstanceOf(ConflictError);
    await expect(new GitHubClient(conn, (async () => res(422)) as any).putFile('x', 'y', 'm', 's')).rejects.toBeInstanceOf(ConflictError);
    await expect(new GitHubClient(conn, (async () => res(401)) as any).getFile('x')).rejects.toBeInstanceOf(AuthError);
  });
  it('PUT body carries message, base64 content and sha', async () => {
    const f = vi.fn().mockResolvedValue(res(200, { content: { sha: 'new' } }));
    const sha = await new GitHubClient(conn, f as any).putFile('config.json', 'héllo', 'msg', 'old');
    expect(sha).toBe('new');
    const body = JSON.parse(f.mock.calls[0][1].body);
    expect(body).toMatchObject({ message: 'msg', sha: 'old' });
    expect(fromBase64(body.content)).toBe('héllo');
  });
});

describe('actions (replayable edits)', () => {
  it('replays on a fresh copy and is idempotent for openMonth', () => {
    let d = apply(emptyData(), { type: 'setConfig', config, message: 'x' });
    d = apply(d, { type: 'openMonth', id: '2026-10' });
    const again = apply(d, { type: 'openMonth', id: '2026-10' });
    expect(again).toBe(d);
    d = apply(d, { type: 'logSurprise', m: '2026-10', s: { id: 's1', date: '2026-10-05', what: 'Battery', rm: 350, paidFrom: 'gifts', emergency: false } });
    expect(d.months['2026-10'].movements[0].rm).toBe(-350);
    expect(describeAction({ type: 'logSurprise', m: '2026-10', s: { id: 's1', date: '2026-10-05', what: 'Battery', rm: 350, paidFrom: 'gifts', emergency: false } })).toBe('2026-10: log surprise "Battery" RM350');
  });
});

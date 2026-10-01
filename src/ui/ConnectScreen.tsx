import { useState } from 'react';
import { store } from '../storage/store';
import { useSnap } from '../ui-kit';

export function ConnectForm({ onConnected }: { onConnected?: () => void }) {
  const snap = useSnap();
  const [owner, setOwner] = useState(snap.conn?.owner ?? 'yoomom');
  const [repo, setRepo] = useState(snap.conn?.repo ?? 'money-data');
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true); setMsg('');
    try {
      await store.connect({ owner: owner.trim(), repo: repo.trim(), token: token.trim() });
      setToken('');
      setMsg('Connected.');
      onConnected?.();
    } catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <>
      <label className="field">GitHub owner<input value={owner} autoCapitalize="none" onChange={(e) => setOwner(e.target.value)} /></label>
      <label className="field">Data repo<input value={repo} autoCapitalize="none" onChange={(e) => setRepo(e.target.value)} /></label>
      <label className="field">Fine-grained token (Contents: read and write on this repo only)
        <input type="password" value={token} autoComplete="off" autoCapitalize="none" onChange={(e) => setToken(e.target.value)} placeholder="github_pat_…" /></label>
      <button className="primary" style={{ width: '100%' }} disabled={busy || !token.trim() || !owner || !repo} onClick={run}>{busy ? 'Testing…' : 'Test and save'}</button>
      {msg && <p className={msg === 'Connected.' ? 'muted' : ''} style={msg === 'Connected.' ? undefined : { color: 'var(--red)' }} role="status">{msg}</p>}
    </>
  );
}

export function ConnectScreen() {
  return (
    <div className="app">
      <h1>Money Tracker</h1>
      <p className="muted">Your data stays in your own private GitHub repo. This device needs a token once.</p>
      <div className="card"><ConnectForm /></div>
      <p className="muted">Create the token at github.com/settings/personal-access-tokens/new: only the <b>money-data</b> repo, permission <b>Contents: Read and write</b>.</p>
    </div>
  );
}

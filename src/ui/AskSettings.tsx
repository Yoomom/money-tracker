import { useEffect, useState } from 'react';
import { cache } from '../storage/cache';
import { DEFAULT_SETTINGS, friendlyError, makeTransport, quickCall, type AskSettings as Settings } from '../ai/anthropic';
import { getSpend, usageCost } from '../ai/cost';
import { todayKL } from '../ai/context';
import { toast } from '../ui-kit';

export async function loadSettings(): Promise<Settings> {
  return { ...DEFAULT_SETTINGS, ...((await cache.getKV<Settings>('ask-settings')) ?? {}) };
}
export const saveSettings = (s: Settings) => cache.setKV('ask-settings', s);

export function AskSettings({ onChange }: { onChange?: (s: Settings) => void }) {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [key, setKey] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [spend, setSpend] = useState(0);
  useEffect(() => { void loadSettings().then(setS); void getSpend(todayKL()).then((x) => setSpend(x.usd)); }, []);

  const update = async (patch: Partial<Settings>) => { const n = { ...s, ...patch }; setS(n); await saveSettings(n); onChange?.(n); };

  const test = async () => {
    setBusy(true); setMsg('');
    try {
      const apiKey = key.trim() || s.apiKey;
      const r = await quickCall(makeTransport(apiKey), s.model, 'Reply with the single word: ok', 'low');
      if (key.trim()) { await update({ apiKey }); setKey(''); }
      setMsg(`Works. Test cost ~US$${usageCost(r.usage, s.model).toFixed(4)}.`);
    } catch (e) { setMsg(friendlyError(e)); } finally { setBusy(false); }
  };

  return (
    <div>
      <p className="muted">This uses a Claude API key (pay-per-use), not your Claude subscription. Your subscription works through the Claude app connector.</p>
      <label className="field">API key {s.apiKey && <span className="pill">saved on this device: …{s.apiKey.slice(-4)}</span>}
        <input type="password" autoComplete="off" autoCapitalize="none" value={key} placeholder={s.apiKey ? 'Paste a new key to replace' : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} /></label>
      <div className="row">
        <button className="primary grow" disabled={busy || !(key.trim() || s.apiKey)} onClick={test}>{busy ? 'Testing…' : 'Test'}</button>
        {s.apiKey && <button className="danger" onClick={async () => { await update({ apiKey: '' }); setMsg('Key removed from this device.'); toast('API key removed'); }}>Remove</button>}
      </div>
      {msg && <p role="status" className="muted">{msg}</p>}
      <label className="field">Model<input value={s.model} onChange={(e) => void update({ model: e.target.value.trim() || DEFAULT_SETTINGS.model })} /></label>
      <label className="field">Effort
        <select value={s.effort} onChange={(e) => void update({ effort: e.target.value as Settings['effort'] })}>
          <option value="low">Low (cheapest)</option><option value="medium">Medium (default)</option><option value="high">High</option>
        </select></label>
      <label className="field">Monthly cap (US$)
        <input inputMode="decimal" value={s.capUsd} onChange={(e) => { const n = parseFloat(e.target.value); void update({ capUsd: Number.isFinite(n) ? n : 0 }); }} /></label>
      <p className="muted">Spent this month on this device: ~US${spend.toFixed(2)} of US${s.capUsd}.</p>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { useApp, HEALTH_TITLES } from './app-data';
import { NumInput, Screen, toast } from '../ui-kit';
import { store } from '../storage/store';
import { fmtRM } from '../domain/util';
import { evaluateHealth } from '../domain/health';
import { suggestedSweep } from '../domain/month';

export function ReviewScreen({ onBack }: { onBack: () => void }) {
  const { config, month, all, curId } = useApp();
  const suggested = useMemo(() => (config && month ? suggestedSweep(month, config) : 0), [config, month]);
  const [sweep, setSweep] = useState<number | undefined>(suggested);
  const [notes, setNotes] = useState('');
  if (!config || !month) return null;
  const health = evaluateHealth({ config, month, months: all, closing: true });
  const order = (h: (typeof health)[number]) => (h.info ? 3 : h.status === 'red' ? 0 : h.status === 'amber' ? 1 : 2);
  const tri = (v: boolean | undefined) => (v === true ? 'yes' : v === false ? 'no' : '');

  return (
    <Screen title="Month review" onBack={onBack}>
      <div className="card">
        {[...health].sort((a, b) => order(a) - order(b)).map((h) => (
          <div key={h.id} className="item">
            <span className={`pill`} style={{ background: `var(--${h.info ? 'info' : h.status}-bg)`, color: `var(--${h.info ? 'info' : h.status})` }}>{h.info ? 'info' : h.status}</span>
            <div className="grow"><b>{HEALTH_TITLES[h.id]}</b> <span className="muted">{h.value}</span><div className="muted">{h.why}</div></div>
          </div>
        ))}
      </div>

      <h2>Two quick questions</h2>
      <div className="card">
        <label className="field">Card paid in full this month?
          <select value={tri(month.checks.cardPaidInFull)} onChange={(e) => store.dispatch({ type: 'setChecks', m: curId, checks: { cardPaidInFull: e.target.value === '' ? undefined : e.target.value === 'yes' } })}>
            <option value="">Not answered</option><option value="yes">Yes</option><option value="no">No</option>
          </select></label>
        <label className="row" style={{ minHeight: 44 }}>
          <input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={!!month.checks.experienceLogged}
            onChange={(e) => store.dispatch({ type: 'setChecks', m: curId, checks: { experienceLogged: e.target.checked } })} />
          I did something I loved this month
        </label>
      </div>

      <h2>Sweep leftovers</h2>
      <div className="card">
        <p className="muted">Suggested from underspend: {fmtRM(suggested)}. It moves into the emergency fund.</p>
        <NumInput value={sweep} onCommit={setSweep} />
      </div>

      <label className="field">One lesson from this month<textarea value={notes} onChange={(e) => setNotes(e.target.value)} /></label>
      <button className="primary" style={{ width: '100%' }} onClick={() => {
        store.dispatch({ type: 'close', m: curId, sweepRm: sweep ?? 0, notes, closedAt: new Date().toISOString() });
        toast('Month closed');
        onBack();
      }}>Close month</button>
    </Screen>
  );
}

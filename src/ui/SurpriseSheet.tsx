import { useState } from 'react';
import { useApp } from './app-data';
import { NumInput, Sheet, toast } from '../ui-kit';
import { store } from '../storage/store';
import { apply, newId } from '../storage/actions';
import { fmtRM, round2, todayISO } from '../domain/util';
import { fundBalance } from '../domain/funds';

export function SurpriseSheet({ onClose }: { onClose: () => void }) {
  const { config, month, curId, all, snap } = useApp();
  const [rm, setRm] = useState<number | undefined>();
  const [what, setWhat] = useState('');
  const [date, setDate] = useState(todayISO());
  const [from, setFrom] = useState<string>('');
  const [real, setReal] = useState(false);
  if (!config || !month) return null;

  const funds = config.funds.filter((f) => f.kind === 'sinking' || f.kind === 'emergency');
  const chips = [
    ...funds.map((f) => ({ id: f.id, label: f.name })),
    { id: 'guiltfree', label: 'Guilt-free' },
    { id: 'surplus', label: "This month's surplus" },
    { id: 'unassigned', label: 'Not sure' },
  ];
  const fund = config.funds.find((f) => f.id === from);
  const isEmergency = fund?.kind === 'emergency';
  const ok = !!rm && rm > 0 && what.trim() && from;

  const save = () => {
    const s = { id: newId('sp'), date, what: what.trim(), rm: round2(rm!), paidFrom: from, emergency: isEmergency ? real : false };
    store.dispatch({ type: 'logSurprise', m: curId, s });
    if (fund) {
      const after = apply(snap.data, { type: 'logSurprise', m: curId, s });
      const list = Object.values(after.months);
      toast(`${fund.name} now ${fmtRM(fundBalance(fund, list))}`);
    } else toast(from === 'unassigned' ? 'Logged — assign it later to clear the leak' : 'Logged');
    onClose();
  };
  void all;

  return (
    <Sheet title="Log a surprise" onClose={onClose}>
      <label className="field">Amount (RM)<NumInput autoFocus value={rm} onCommit={setRm} placeholder="0.00" /></label>
      <label className="field">What was it?<input value={what} onChange={(e) => setWhat(e.target.value)} placeholder="e.g. Car battery" /></label>
      <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div className="muted" style={{ margin: '8px 0 4px' }}>Paid from</div>
      <div className="chips" role="radiogroup" aria-label="Paid from">
        {chips.map((c) => (
          <button key={c.id} role="radio" aria-checked={from === c.id} className={`chip${from === c.id ? ' on' : ''}`} onClick={() => setFrom(c.id)}>{c.label}</button>
        ))}
      </div>
      {isEmergency && (
        <label className="row" style={{ minHeight: 44, marginTop: 10 }}>
          <input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={real} onChange={(e) => setReal(e.target.checked)} />
          Was it a real emergency?
        </label>
      )}
      {fund && rm ? <p className="muted">{fund.name} after: {fmtRM(fundBalance(fund, Object.values(snap.data.months)) - rm)}</p> : null}
      <button className="primary" style={{ width: '100%', marginTop: 12 }} disabled={!ok} onClick={save}>Save</button>
    </Sheet>
  );
}

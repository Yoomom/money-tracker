import { useState } from 'react';
import { useApp, monthLabel } from './app-data';
import { Bar, NumInput, toast } from '../ui-kit';
import { store } from '../storage/store';
import { newId } from '../storage/actions';
import { fmtRM, round2, todayISO } from '../domain/util';
import { etaMonth, fundBalance, fundMovements, fundTarget, monthlyTopUp, monthsToTarget } from '../domain/funds';
import { resolveAll } from '../domain/plan';
import type { Fund } from '../domain/types';

export function FundsScreen() {
  const { config, all, curId, month, readOnly } = useApp();
  const [adjusting, setAdjusting] = useState<string | null>(null);
  if (!config) return <p className="muted">Loading…</p>;
  const amounts = resolveAll(config);

  return (
    <>
      <h1>Funds</h1>
      {config.funds.map((f) => {
        const bal = fundBalance(f, all);
        const target = fundTarget(config, f);
        const top = monthlyTopUp(config, f.id, amounts);
        const n = target ? monthsToTarget(bal, target, top) : null;
        const eta = etaMonth(curId, n);
        const moves = fundMovements(f, all).slice(0, 5);
        return (
          <div key={f.id} className="card">
            <div className="row between"><h3>{f.name}</h3><span className="num"><b>{fmtRM(bal)}</b></span></div>
            {target ? (
              <>
                <Bar value={bal} max={target} />
                <div className="row between muted" style={{ marginTop: 4 }}>
                  <span>Target {fmtRM(target)}</span>
                  <span>{n === 0 ? 'Reached' : eta ? `ETA ${monthLabel(eta)}` : 'No top-up planned'}</span>
                </div>
              </>
            ) : top > 0 ? <div className="muted">+{fmtRM(top)} / month</div> : null}
            {moves.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {moves.map((m) => (
                  <div key={m.id} className="row between muted" style={{ minHeight: 28 }}>
                    <span>{m.date} · {m.note || m.reason}</span>
                    <span className="num" style={{ color: m.rm < 0 ? 'var(--red)' : 'var(--green)' }}>{m.rm > 0 ? '+' : ''}{fmtRM(m.rm)}</span>
                  </div>
                ))}
              </div>
            )}
            {!readOnly && month && (adjusting === f.id
              ? <Adjust fund={f} onDone={() => setAdjusting(null)} />
              : <button style={{ marginTop: 8 }} onClick={() => setAdjusting(f.id)}>Adjust</button>)}
          </div>
        );
      })}
    </>
  );
}

function Adjust({ fund, onDone }: { fund: Fund; onDone: () => void }) {
  const { curId } = useApp();
  const [rm, setRm] = useState<number | undefined>();
  const [note, setNote] = useState('');
  return (
    <div style={{ marginTop: 8 }}>
      <label className="field">Amount (use − to withdraw)<NumInput allowNegative value={rm} onCommit={setRm} placeholder="e.g. 250 or -80" /></label>
      <label className="field">Note<input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. match bank balance" /></label>
      <div className="row">
        <button onClick={onDone}>Cancel</button>
        <button className="primary grow" disabled={!rm || !note.trim()} onClick={() => {
          store.dispatch({ type: 'adjustFund', m: curId, fundId: fund.id, rm: round2(rm!), note: note.trim(), date: todayISO(), id: newId('mv') });
          toast(`${fund.name} adjusted`);
          onDone();
        }}>Save adjustment</button>
      </div>
    </div>
  );
}

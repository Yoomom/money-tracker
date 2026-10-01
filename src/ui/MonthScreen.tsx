import { useState } from 'react';
import { useApp, HEALTH_TITLES, monthLabel } from './app-data';
import { Bar, NumInput, toast } from '../ui-kit';
import { store } from '../storage/store';
import { newId } from '../storage/actions';
import { fmtRM, round2, sum, todayISO } from '../domain/util';
import { monthPlanned, profitFirstSplit, salaryOf, setSalary } from '../domain/month';
import type { IncomeEntry, HealthResult } from '../domain/types';

export function MonthScreen({ onReview, onHistory }: { onReview: () => void; onHistory: () => void }) {
  const { config, month, health, overall, readOnly, curId } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState('');
  if (!config || !month) return <p className="muted">Opening month…</p>;

  const today = new Date();
  const lastWeek = today.getDate() > new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate() - 7;
  const salary = salaryOf(month, config.takeHome);
  const detail = health.find((h) => h.id === open);

  return (
    <>
      <div className="row between">
        <h1>{monthLabel(month.id)}</h1>
        <button className="link" onClick={onHistory}>History</button>
      </div>
      {readOnly && <div className="banner">This month is closed.</div>}
      <div className={`status ${overall.onTrack ? 'ok' : 'bad'}`}>
        {overall.onTrack ? 'On track' : 'Needs attention'}
        <div className="muted" style={{ color: 'inherit', opacity: 0.85, fontWeight: 400 }}>
          {overall.onTrack ? `${overall.greens} of ${health.length} checks green` : overall.reds.map((r) => HEALTH_TITLES[r.id]).join(' · ')}
        </div>
      </div>

      <div className="tiles">
        {[...health].sort((a, b) => rank(a) - rank(b)).map((h) => (
          <button key={h.id} className={`tile ${h.info ? 'info' : h.status}`} onClick={() => setOpen(open === h.id ? null : h.id)} aria-expanded={open === h.id}>
            <div className="t">{HEALTH_TITLES[h.id]}</div>
            <div className="v">{h.value}</div>
          </button>
        ))}
      </div>
      {detail && (
        <div className="detail">
          <b>{HEALTH_TITLES[detail.id]}:</b> {detail.why}.<div className="muted">Source: {detail.source}</div>
        </div>
      )}

      <h2>Pockets</h2>
      <div className="card">
        {config.pockets.map((p) => {
          const items = month.items.filter((i) => (i.pocketId ?? config.items.find((c) => c.id === i.itemId)?.pocketId ?? 'safety') === p.id);
          if (!items.length) return null;
          const planned = sum(items.map((i) => i.planned));
          const actual = sum(items.map((i) => (i.done ? i.actual ?? i.planned : 0)));
          return (
            <div key={p.id} style={{ margin: '8px 0 12px' }}>
              <div className="row between"><span>{p.name}</span><span className="num muted">{fmtRM(actual)} / {fmtRM(planned)}</span></div>
              <Bar value={actual} max={planned} />
            </div>
          );
        })}
        <div className="row between muted"><span>Planned total</span><span className="num">{fmtRM(monthPlanned(month))} of {fmtRM(salary)}</span></div>
      </div>

      <h2>Income</h2>
      <div className="card">
        {month.income.map((inc) => (
          <IncomeRow key={inc.id} inc={inc} readOnly={readOnly} onSalary={(rm) => {
            const r = setSalary(month, config, rm);
            store.dispatch({ type: 'setSalary', m: curId, rm });
            if (r.notice) setNotice(r.notice);
          }} />
        ))}
        {notice && <div className="detail" role="status">{notice}</div>}
        {!readOnly && !adding && <button onClick={() => setAdding(true)} style={{ width: '100%', marginTop: 8 }}>Add income</button>}
        {adding && <AddIncome onDone={() => setAdding(false)} />}
      </div>

      {month.surprises.length > 0 && (
        <>
          <h2>Surprises</h2>
          <div className="card">
            {month.surprises.map((s) => (
              <div key={s.id} className="item">
                <div className="grow"><div>{s.what}</div><div className="muted">{s.date} · from {sourceName(config, s.paidFrom)}</div></div>
                <span className="num">{fmtRM(s.rm)}</span>
                {!readOnly && <button className="link danger" aria-label={`Delete ${s.what}`} onClick={() => { store.dispatch({ type: 'deleteSurprise', m: curId, id: s.id }); toast('Surprise deleted'); }}>✕</button>}
              </div>
            ))}
          </div>
        </>
      )}

      {!readOnly && (
        <button className={lastWeek ? 'primary' : ''} style={{ width: '100%', marginTop: 16 }} onClick={onReview}>
          {lastWeek ? 'Close month' : 'Close month early'}
        </button>
      )}
    </>
  );
}

const rank = (h: HealthResult) => (h.info ? 3 : h.status === 'red' ? 0 : h.status === 'amber' ? 1 : 2);

export function sourceName(config: import('../domain/types').Config, paidFrom: string) {
  if (paidFrom === 'surplus') return "this month's surplus";
  if (paidFrom === 'unassigned') return 'not sure';
  return config.funds.find((f) => f.id === paidFrom)?.name ?? config.pockets.find((p) => p.id === paidFrom)?.name ?? paidFrom;
}

function IncomeRow({ inc, readOnly, onSalary }: { inc: IncomeEntry; readOnly: boolean; onSalary: (rm: number) => void }) {
  const { config, curId } = useApp();
  const biz = inc.source === 'creator' || inc.source === 'freelance';
  const split = biz && config ? profitFirstSplit(inc.rm, config.givingPct) : null;
  return (
    <div style={{ padding: '4px 0', borderBottom: '1px solid var(--line)' }}>
      <div className="row between">
        <div>{inc.source === 'salary' ? 'Salary' : inc.stream || inc.source}<div className="muted">{inc.date}</div></div>
        {inc.source === 'salary' && !readOnly
          ? <NumInput className="actualinput" value={inc.rm} onCommit={(n) => n != null && onSalary(n)} />
          : <span className="num">{fmtRM(inc.rm)}</span>}
        {inc.source !== 'salary' && !readOnly && <button className="link danger" aria-label="Remove income" onClick={() => store.dispatch({ type: 'removeIncome', m: curId, id: inc.id })}>✕</button>}
      </div>
      {split && (
        <div className="detail">
          Move now: give {fmtRM(split.giving)} · you {fmtRM(split.owner)} · costs {fmtRM(split.opex)} · tax {fmtRM(split.tax)} · profit {fmtRM(split.profit)}
          <label className="row" style={{ minHeight: 44 }}>
            <input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={!!inc.split} disabled={readOnly}
              onChange={(e) => store.dispatch({ type: 'markSplit', m: curId, id: inc.id, split: e.target.checked })} />
            I've moved it
          </label>
        </div>
      )}
    </div>
  );
}

function AddIncome({ onDone }: { onDone: () => void }) {
  const { curId } = useApp();
  const [source, setSource] = useState<IncomeEntry['source']>('creator');
  const [stream, setStream] = useState('');
  const [rm, setRm] = useState<number | undefined>();
  const [date, setDate] = useState(todayISO());
  return (
    <div style={{ marginTop: 8 }}>
      <label className="field">Type
        <select value={source} onChange={(e) => setSource(e.target.value as IncomeEntry['source'])}>
          <option value="creator">Creator</option><option value="freelance">Freelance</option><option value="salary">Salary (extra)</option><option value="other">Other</option>
        </select></label>
      <label className="field">Stream / client<input value={stream} onChange={(e) => setStream(e.target.value)} placeholder="e.g. YouTube AdSense" /></label>
      <label className="field">Amount (RM)<NumInput value={rm} onCommit={setRm} /></label>
      <label className="field">Date<input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></label>
      <div className="row">
        <button onClick={onDone}>Cancel</button>
        <button className="primary grow" disabled={!rm} onClick={() => {
          store.dispatch({ type: 'addIncome', m: curId, entry: { id: newId('inc'), source, stream: stream || undefined, rm: round2(rm!), date, split: false } });
          toast('Income added');
          onDone();
        }}>Add</button>
      </div>
    </div>
  );
}

import { useState } from 'react';
import { useApp } from './app-data';
import { NumInput } from '../ui-kit';
import { store } from '../storage/store';
import { fmtRM, sum, todayISO } from '../domain/util';

export function PaydayScreen() {
  const { config, month, readOnly, curId } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  if (!config || !month) return <p className="muted">Opening month…</p>;
  const done = month.items.filter((i) => i.done).length;
  const info = (id: string, pocketFallback?: string) => {
    const c = config.items.find((x) => x.id === id);
    return { name: c?.name ?? month.items.find((i) => i.itemId === id)?.name ?? id, pocketId: c?.pocketId ?? pocketFallback ?? 'safety' };
  };

  return (
    <>
      <h1>Payday</h1>
      <div className="card">
        <div className="row between"><b>{done} of {month.items.length} done</b><span className="num muted">{fmtRM(sum(month.items.filter((i) => i.done).map((i) => i.actual ?? i.planned)))} moved</span></div>
        <div className="bar" style={{ marginTop: 8 }}><i style={{ width: `${month.items.length ? (done / month.items.length) * 100 : 0}%` }} /></div>
      </div>
      {[...config.pockets].sort((a, b) => a.order - b.order).map((p) => {
        const items = month.items.filter((i) => info(i.itemId, i.pocketId).pocketId === p.id);
        if (!items.length) return null;
        return (
          <div key={p.id} className="card">
            <div className="row between"><h3>{p.name}</h3><span className="muted num">{items.filter((i) => i.done).length}/{items.length} · {fmtRM(sum(items.map((i) => i.planned)))}</span></div>
            {items.map((it) => {
              const { name } = info(it.itemId);
              return (
                <div key={it.itemId} className="item">
                  <button className={`check${it.done ? ' on' : ''}`} aria-label={`${it.done ? 'Untick' : 'Tick'} ${name}`} aria-pressed={it.done} disabled={readOnly}
                    onClick={() => store.dispatch(it.done ? { type: 'untick', m: curId, itemId: it.itemId } : { type: 'tick', m: curId, itemId: it.itemId, date: todayISO() })}>
                    {it.done ? '✓' : ''}
                  </button>
                  <div className="grow">{name}{it.oneOff && <span className="pill" style={{ marginLeft: 6 }}>one-off</span>}</div>
                  {editing === it.itemId ? (
                    <NumInput autoFocus className="actualinput" value={it.actual ?? it.planned} onCommit={(n) => {
                      setEditing(null);
                      if (n != null && n !== it.planned) store.dispatch({ type: 'setActual', m: curId, itemId: it.itemId, actual: n });
                    }} />
                  ) : (
                    <button className="amt" disabled={readOnly} onClick={() => setEditing(it.itemId)} aria-label={`Edit amount for ${name}`}>
                      {fmtRM(it.actual ?? it.planned)}
                      {it.actual != null && it.actual !== it.planned && <div className="muted" style={{ fontSize: '0.7rem' }}>plan {fmtRM(it.planned)}</div>}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

import { useState } from 'react';
import { useApp } from './app-data';
import { NumInput, TextInput, toast } from '../ui-kit';
import { store } from '../storage/store';
import { ConnectForm } from './ConnectScreen';
import { fmtRM, round2, slug } from '../domain/util';
import { resolveAll, totalPlanned, unallocated } from '../domain/plan';
import { DEFAULT_CLASSIFIER, KIND_ORDER } from '../import/classify';
import { KIND_LABEL } from '../import/build';
import { validateConfig } from './ImportScreen';
import { AskSettings } from './AskSettings';
import type { AmountRule, Config, Fund, PlanItem } from '../domain/types';

export function PlanScreen({ onImport }: { onImport: () => void }) {
  const { config, month, curId, snap, all } = useApp();
  const [editing, setEditing] = useState<string | null>(null);
  const [restore, setRestore] = useState('');
  const [showRestore, setShowRestore] = useState(false);
  if (!config) return null;
  const amounts = resolveAll(config);
  const un = unallocated(config);

  const edit = (fn: (c: Config) => Config, message: string) => store.dispatch({ type: 'setConfig', config: fn(config), message });
  const updateItem = (id: string, patch: Partial<PlanItem>) =>
    edit((c) => ({ ...c, items: c.items.map((i) => (i.id === id ? { ...i, ...patch } : i)) }), `Plan: edit ${config.items.find((i) => i.id === id)?.name}`);
  const setRule = (id: string, rule: AmountRule) =>
    edit((c) => ({
      ...c,
      items: c.items.map((i) => {
        if (i.id === id) return { ...i, rule };
        // only one remainder item is allowed
        return rule.type === 'remainder' && i.rule.type === 'remainder' ? { ...i, rule: { type: 'fixed', rm: amounts.get(i.id) ?? 0 } as AmountRule } : i;
      }),
    }), `Plan: rule for ${config.items.find((i) => i.id === id)?.name}`);

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ config, months: Object.values(snap.data.months) }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `money-tracker-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  const doRestore = () => {
    try {
      const j = JSON.parse(restore);
      const cfg = j.config ?? j;
      if (!validateConfig(cfg)) throw new Error('Not a Money Tracker export.');
      store.dispatch({ type: 'setConfig', config: cfg, message: 'Restore from export' });
      for (const m of (j.months ?? []) as any[]) store.dispatch({ type: 'putMonth', month: m });
      setRestore(''); setShowRestore(false); toast('Restored');
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <>
      <h1>Plan & settings</h1>
      <div className="card">
        <div className="row between"><span>Take-home</span><b className="num">{fmtRM(config.takeHome)}</b></div>
        <div className="row between"><span>Planned</span><b className="num">{fmtRM(totalPlanned(config))}</b></div>
        <div className="row between"><span>Unallocated</span><b className="num" style={{ color: un === 0 ? 'var(--green)' : 'var(--red)' }}>{fmtRM(un)}</b></div>
        <button style={{ width: '100%', marginTop: 8 }} onClick={onImport}>Import from Excel</button>
        {month?.status === 'open' && (
          <button style={{ width: '100%', marginTop: 8 }} onClick={() => { store.dispatch({ type: 'setConfig', config, message: `${curId}: apply plan to this month`, applyToMonth: curId }); toast('Plan applied to this month'); }}>
            Apply plan to this month
          </button>
        )}
        <p className="muted">Edits change next month's plan. Use "Apply plan to this month" to refresh the open month too.</p>
      </div>

      <h2>Basics</h2>
      <div className="card">
        <label className="field">Take-home salary (RM)<NumInput value={config.takeHome} onCommit={(n) => n != null && edit((c) => ({ ...c, takeHome: n }), 'Plan: take-home')} /></label>
        <label className="field">Gross salary (RM, for the car 20/3/8 check)<NumInput value={config.gross ?? undefined} onCommit={(n) => edit((c) => ({ ...c, gross: n ?? null }), 'Plan: gross')} /></label>
        <label className="field">Giving % of income<NumInput value={round2(config.givingPct * 100)} onCommit={(n) => n != null && edit((c) => ({ ...c, givingPct: n / 100 }), 'Plan: giving %')} /></label>
        <label className="field">Emergency fund target (months of fixed costs)<NumInput value={config.efTargetMonths} onCommit={(n) => n != null && edit((c) => ({ ...c, efTargetMonths: n }), 'Plan: EF months')} /></label>
      </div>

      <h2>Items</h2>
      {[...config.pockets].sort((a, b) => a.order - b.order).map((p) => (
        <div key={p.id} className="card">
          <h3>{p.name}</h3>
          {config.items.filter((i) => i.pocketId === p.id).map((it) => (
            <div key={it.id} style={{ borderBottom: '1px solid var(--line)' }}>
              <button className="amt" style={{ width: '100%', textAlign: 'left', display: 'flex', justifyContent: 'space-between' }} onClick={() => setEditing(editing === it.id ? null : it.id)} aria-expanded={editing === it.id}>
                <span>{it.name}</span><span className="num">{fmtRM(amounts.get(it.id) ?? 0)}</span>
              </button>
              {editing === it.id && (
                <div style={{ paddingBottom: 10 }}>
                  <label className="field">Name<TextInput value={it.name} onCommit={(name) => updateItem(it.id, { name })} /></label>
                  <label className="field">Pocket
                    <select value={it.pocketId} onChange={(e) => updateItem(it.id, { pocketId: e.target.value })}>
                      {config.pockets.map((pk) => <option key={pk.id} value={pk.id}>{pk.name}</option>)}
                    </select></label>
                  <label className="field">Amount rule
                    <select value={it.rule.type} onChange={(e) => {
                      const t = e.target.value;
                      const cur = amounts.get(it.id) ?? 0;
                      setRule(it.id, t === 'fixed' ? { type: 'fixed', rm: cur } : t === 'percentOfIncome' ? { type: 'percentOfIncome', pct: config.givingPct } : t === 'yearly' ? { type: 'yearly', rmPerYear: round2(cur * 12) } : { type: 'remainder' });
                    }}>
                      <option value="fixed">Fixed RM / month</option><option value="percentOfIncome">% of income</option>
                      <option value="yearly">Yearly cost ÷ 12</option><option value="remainder">Whatever is left</option>
                    </select></label>
                  {it.rule.type === 'fixed' && <label className="field">RM per month<NumInput value={it.rule.rm} onCommit={(n) => n != null && setRule(it.id, { type: 'fixed', rm: n })} /></label>}
                  {it.rule.type === 'percentOfIncome' && <label className="field">% of take-home<NumInput value={round2(it.rule.pct * 100)} onCommit={(n) => n != null && setRule(it.id, { type: 'percentOfIncome', pct: n / 100 })} /></label>}
                  {it.rule.type === 'yearly' && <label className="field">RM per year<NumInput value={it.rule.rmPerYear} onCommit={(n) => n != null && setRule(it.id, { type: 'yearly', rmPerYear: n })} /></label>}
                  <label className="field">Pays into fund
                    <select value={it.fundId ?? ''} onChange={(e) => updateItem(it.id, { fundId: e.target.value || undefined })}>
                      <option value="">None</option>{config.funds.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                    </select></label>
                  <button className="danger" onClick={() => { edit((c) => ({ ...c, items: c.items.filter((i) => i.id !== it.id) }), `Plan: remove ${it.name}`); setEditing(null); }}>Delete item</button>
                </div>
              )}
            </div>
          ))}
          <button className="link" onClick={() => {
            const name = 'New item';
            let id = slug(name), n = 2;
            while (config.items.some((i) => i.id === id)) id = `new-item-${n++}`;
            edit((c) => ({ ...c, items: [...c.items, { id, pocketId: p.id, name, rule: { type: 'fixed', rm: 0 } }] }), `Plan: add item to ${p.name}`);
            setEditing(id);
          }}>+ Add item</button>
        </div>
      ))}

      <h2>Funds</h2>
      {config.funds.map((f) => (
        <div key={f.id} className="card">
          <label className="field">Name<TextInput value={f.name} onCommit={(name) => edit((c) => ({ ...c, funds: c.funds.map((x) => (x.id === f.id ? { ...x, name } : x)) }), `Plan: rename fund ${f.name}`)} /></label>
          <div className="row">
            <label className="field grow">Opening balance<NumInput allowNegative value={f.opening} onCommit={(n) => n != null && patchFund(edit, f, { opening: n })} /></label>
            {f.kind !== 'emergency' && <label className="field grow">Target<NumInput value={f.target} onCommit={(n) => patchFund(edit, f, { target: n })} /></label>}
          </div>
        </div>
      ))}

      <h2>Auto-sorting keywords</h2>
      <div className="card">
        <p className="muted">Used when importing Excel. Comma separated; first match wins in this order.</p>
        {KIND_ORDER.map((k) => {
          const words = (config.classifier ?? DEFAULT_CLASSIFIER)[k] ?? [];
          return (
            <label key={k} className="field">{KIND_LABEL[k]}
              <TextInput value={words.join(', ')} onCommit={(s) => edit((c) => ({ ...c, classifier: { ...(c.classifier ?? DEFAULT_CLASSIFIER), [k]: s.split(',').map((x) => x.trim()).filter(Boolean) } }), 'Plan: keywords')} /></label>
          );
        })}
      </div>

      <h2>Connection</h2>
      <div className="card">
        {snap.conn && <p className="muted">Connected to {snap.conn.owner}/{snap.conn.repo}. {snap.demo ? '' : `${snap.pendingCount} unsynced edit(s).`}</p>}
        <ConnectForm />
        {snap.conn && <button className="danger" style={{ width: '100%', marginTop: 8 }} onClick={() => confirm('Remove token and cached data from this device?') && store.disconnect()}>Disconnect this device</button>}
      </div>

      <h2>Ask (Claude)</h2>
      <div className="card"><AskSettings /></div>

      <h2>Your data</h2>
      <div className="card">
        <button style={{ width: '100%' }} onClick={exportAll}>Export JSON ({all.length} month{all.length === 1 ? '' : 's'} + plan)</button>
        <button className="link" onClick={() => setShowRestore(!showRestore)}>Import from an export</button>
        {showRestore && <><textarea value={restore} onChange={(e) => setRestore(e.target.value)} placeholder="Paste exported JSON" /><button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={!restore.trim()} onClick={doRestore}>Restore</button></>}
      </div>
    </>
  );
}

function patchFund(edit: (fn: (c: Config) => Config, m: string) => void, f: Fund, patch: Partial<Fund>) {
  edit((c) => ({ ...c, funds: c.funds.map((x) => (x.id === f.id ? { ...x, ...patch } : x)) }), `Plan: fund ${f.name}`);
}

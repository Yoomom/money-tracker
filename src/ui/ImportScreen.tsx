import { useMemo, useRef, useState } from 'react';
import { Screen, NumInput, toast } from '../ui-kit';
import { store } from '../storage/store';
import { useApp } from './app-data';
import { buildConfig, diffConfigs, KIND_LABEL, orderedRows, reclassify, removeRow, setRowAmount, splitRow } from './import-helpers';
import type { ImportResult, ImportRow } from '../import/excel';
import type { Config, PocketKind } from '../domain/types';
import { fmtRM } from '../domain/util';

const KINDS = Object.keys(KIND_LABEL) as PocketKind[];
const chip = (r: ImportRow) =>
  r.rule.type === 'percentOfIncome' ? `${+(r.rule.pct * 100).toFixed(2)}% of income`
  : r.rule.type === 'yearly' ? `${fmtRM(r.rule.rmPerYear)} ÷ 12`
  : r.rule.type === 'remainder' ? 'remainder' : 'fixed';

export function validateConfig(c: any): c is Config {
  return c && c.version === 1 && Array.isArray(c.pockets) && Array.isArray(c.items) && Array.isArray(c.funds) && typeof c.takeHome === 'number';
}

export function ImportScreen({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const { config: existing, curId, month } = useApp();
  const [res, setRes] = useState<ImportResult | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [applyNow, setApplyNow] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const built = useMemo(() => (res ? buildConfig(rows, res.inputs, { existing: existing ?? undefined }) : null), [res, rows, existing]);
  const diff = useMemo(() => (built && existing ? diffConfigs(existing, built.config) : null), [built, existing]);

  const onFile = async (f: File) => {
    setBusy(true); setErr('');
    try {
      const { parseWorkbook, readWorkbook } = await import('../import/excel');
      const r = parseWorkbook(readWorkbook(await f.arrayBuffer()), f.name, existing?.classifier);
      if (!r.rows.length) throw new Error(r.warnings[0] ?? 'Nothing recognisable found in this workbook.');
      setRes(r); setRows(r.rows);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  const save = () => {
    if (!built || !res) return;
    store.dispatch({ type: 'setConfig', config: built.config, message: `Import from ${res.fileName ?? 'Excel'}`, applyToMonth: applyNow && month?.status === 'open' ? curId : undefined });
    toast('Plan saved'); onDone();
  };

  const savePaste = () => {
    try {
      const c = JSON.parse(paste);
      if (!validateConfig(c)) throw new Error('That does not look like a Money Tracker config (version 1 with pockets, items, funds, takeHome).');
      store.dispatch({ type: 'setConfig', config: c, message: 'Import from pasted JSON' });
      toast('Plan saved'); onDone();
    } catch (e) { setErr((e as Error).message); }
  };

  if (!res) {
    return (
      <Screen title="Import your plan" onBack={onBack}>
        <p>Pick your budgeting Excel file. It is read on this phone only; just the resulting plan is saved to your private data repo.</p>
        <input ref={file} type="file" hidden accept=".xlsx,.xls,.xlsm" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
        <button className="primary" style={{ width: '100%' }} disabled={busy} onClick={() => file.current?.click()}>{busy ? 'Reading…' : 'Choose Excel file'}</button>
        {err && <div className="banner err" style={{ marginTop: 12, borderRadius: 10 }}>{err}</div>}
        <h2>No Excel?</h2>
        <button className="link" onClick={() => setShowPaste(!showPaste)}>Paste JSON instead</button>
        {showPaste && (
          <>
            <textarea style={{ minHeight: 160 }} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder='{"version":1,"currency":"MYR",…}' />
            <button className="primary" style={{ width: '100%', marginTop: 8 }} disabled={!paste.trim()} onClick={savePaste}>Save plan</button>
          </>
        )}
      </Screen>
    );
  }

  const s = built!.summary;
  const groups: { title: string; rows: ImportRow[] }[] = [
    { title: 'Needs review', rows: rows.filter((r) => !r.kind) },
    ...KINDS.map((k) => ({ title: KIND_LABEL[k], rows: orderedRows(rows.filter((r) => r.kind === k)) })),
  ].filter((g) => g.rows.length);

  return (
    <Screen title="Check your plan" onBack={() => setRes(null)}>
      <div className="card" style={{ position: 'sticky', top: 0, zIndex: 2 }}>
        <div className="row between"><span>Take-home</span><b className="num">{fmtRM(s.takeHome)}</b></div>
        <div className="row between"><span>Planned</span><b className="num">{fmtRM(s.totalPlanned)}</b></div>
        <div className="row between"><span>Unallocated</span><b className="num" style={{ color: s.unallocated === 0 && !s.overBy ? 'var(--green)' : 'var(--red)' }}>{fmtRM(s.unallocated)}</b></div>
        {s.overBy > 0 && <div className="detail" style={{ borderColor: 'var(--red)' }}>Plan is {fmtRM(s.overBy)} over salary. Consider trimming: {s.trims.join(', ') || 'a fixed item'}.</div>}
        {s.needsReview > 0 && <div className="muted">{s.needsReview} item(s) need a pocket before you can save.</div>}
      </div>
      {res.warnings.map((w) => <div key={w} className="detail">{w}</div>)}

      {groups.map((g) => (
        <div key={g.title} className="card" style={g.title === 'Needs review' ? { borderColor: 'var(--amber)' } : undefined}>
          <h3>{g.title}</h3>
          {g.rows.map((r) => (
            <div key={r.key} style={{ padding: '6px 0', borderBottom: '1px solid var(--line)' }}>
              <div className="row between">
                <div className="grow"><b>{r.name}</b> <span className="pill">{chip(r)}</span></div>
                {r.rule.type === 'fixed'
                  ? <NumInput className="actualinput" value={r.amount} onCommit={(n) => n != null && setRows(setRowAmount(rows, r.key, n))} />
                  : <span className="num">{r.rule.type === 'remainder' ? 'auto' : fmtRM(r.amount)}</span>}
              </div>
              <div className="row" style={{ marginTop: 4 }}>
                <select value={r.kind ?? ''} onChange={(e) => setRows(reclassify(rows, r.key, (e.target.value || null) as PocketKind | null))} aria-label={`Pocket for ${r.name}`}>
                  <option value="">Choose pocket…</option>
                  {KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
                {r.flags.includes('split?') && <button onClick={() => setRows(splitRow(rows, r.key))}>Split</button>}
                <button className="danger" aria-label={`Remove ${r.name}`} onClick={() => setRows(removeRow(rows, r.key))}>Remove</button>
              </div>
              {r.flags.includes('duplicate?') && <span className="flag">Possible duplicate?</span>}
              {r.flags.includes('split?') && <span className="flag" style={{ marginLeft: 6 }}>Two items in one?</span>}
            </div>
          ))}
        </div>
      ))}

      {diff && (diff.added.length || diff.changed.length || diff.removed.length) ? (
        <div className="card">
          <h3>Compared with your current plan</h3>
          {diff.added.map((x) => <div key={x} className="muted">＋ {x}</div>)}
          {diff.changed.map((x) => <div key={x} className="muted">≠ {x}</div>)}
          {diff.removed.map((x) => <div key={x} className="muted">－ {x}</div>)}
          <p className="muted">Fund balances and month history are kept. Changes apply from next month.</p>
          {month?.status === 'open' && (
            <label className="row" style={{ minHeight: 44 }}>
              <input type="checkbox" style={{ width: 24, minHeight: 24 }} checked={applyNow} onChange={(e) => setApplyNow(e.target.checked)} />
              Apply to this month too
            </label>
          )}
        </div>
      ) : null}

      <button className="primary" style={{ width: '100%', margin: '8px 0 24px' }} disabled={!s.saveable} onClick={save}>
        {s.saveable ? `Save plan (${s.itemCount} items)` : 'Fix the items above to save'}
      </button>
    </Screen>
  );
}

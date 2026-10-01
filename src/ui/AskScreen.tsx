import { useEffect, useState } from 'react';
import { useApp } from './app-data';
import { toast } from '../ui-kit';
import { store } from '../storage/store';
import { cache } from '../storage/cache';
import type { Data } from '../storage/actions';
import { buildSnapshot, SNAPSHOT_MAX_CHARS, todayKL } from '../ai/snapshot';
import { CHANGES_INSTRUCTION, COACH_PROMPT } from '../ai/coach';
import { applyChangeSet, buildChangeSet, extractChanges, undoChangeSet, UNDO_WINDOW_MS, type ChangeSet } from '../ai/changes';

const QUICK = ['Am I on track this month?', 'Can I afford RM800 for…', 'What should I tweak next month?', 'Explain my last surprise'];
const DEEPLINK_MAX = 14000;
interface HistoryItem { id: string; at: number; set: ChangeSet }

export function packQuestion(d: Data, today: string, question: string, maxChars = SNAPSHOT_MAX_CHARS) {
  return `${COACH_PROMPT}\n\nMY DATA (JSON, as of ${today}):\n${buildSnapshot(d, today, maxChars)}\n\n${CHANGES_INSTRUCTION}\n\nMY QUESTION:\n${question}`;
}
const deepLink = (text: string) => `claude://claude.ai/new?q=${encodeURIComponent(text)}`;

async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}

export function AskScreen() {
  const { snap } = useApp();
  const today = todayKL();
  const [question, setQuestion] = useState('');
  const [note, setNote] = useState('');
  const [pasted, setPasted] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [preview, setPreview] = useState<ChangeSet | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  useEffect(() => { void cache.getKV<HistoryItem[]>('ask-history').then((h) => setHistory(h ?? [])); }, []);
  const saveHistory = (h: HistoryItem[]) => { setHistory(h); void cache.setKV('ask-history', h.slice(0, 10)); };

  const data = snap.data as Data;
  const isMac = /Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints < 2;

  const ask = async (q?: string) => {
    const text0 = (q ?? question).trim();
    if (!text0) { setNote('Type a question first.'); return; }
    // Trim older months until the desktop link fits.
    let text = '', max = SNAPSHOT_MAX_CHARS;
    for (; max >= 3000; max -= 2000) { text = packQuestion(data, today, text0, max); if (deepLink(text).length <= DEEPLINK_MAX) break; }
    const fits = deepLink(text).length <= DEEPLINK_MAX;
    if (!fits) text = packQuestion(data, today, text0);
    const ok = await copy(text);
    if (isMac && fits) { setNote('Opening Claude Desktop… (also copied, in case it does not open)'); window.location.href = deepLink(text); return; }
    setNote(ok ? 'Copied — paste into Claude.' : 'Could not copy. Use "Show text" below and copy it by hand.');
    window.open('https://claude.ai/new', '_blank', 'noopener');
  };

  const parse = (text: string) => {
    setPreview(null); setErrors([]);
    const ex = extractChanges(text);
    if (!ex.changes) { setErrors([ex.error!]); return; }
    const r = buildChangeSet(ex.changes, data, today);
    if (r.set) setPreview(r.set); else setErrors(r.errors);
  };
  const pasteFromClipboard = async () => {
    try { parse(await navigator.clipboard.readText()); }
    catch { setShowPaste(true); setErrors(['Could not read the clipboard. Paste the reply into the box below.']); }
  };

  const apply = () => {
    if (!preview) return;
    const done = applyChangeSet(preview, store.getSnapshot().data as Data, (a) => store.dispatch(a));
    saveHistory([{ id: `h-${Date.now()}`, at: Date.now(), set: done }, ...history]);
    setPreview(null); setPasted(''); toast('Applied');
  };
  const undo = (h: HistoryItem) => {
    if (Date.now() - h.at > UNDO_WINDOW_MS && !confirm('Undo restores the files as they were before this change. Anything changed since will be lost. Continue?')) return;
    const undone = undoChangeSet(h.set, (a) => store.dispatch(a));
    saveHistory(history.map((x) => (x.id === h.id ? { ...x, set: undone } : x)));
    toast('Undone');
  };

  return (
    <>
      <h1>Ask Claude</h1>
      <p className="muted">Uses your Claude subscription. Nothing is sent from here: the text goes to your clipboard (or Claude Desktop on a Mac).</p>
      <div className="card">
        <div className="chips">{QUICK.map((q) => <button key={q} className="chip" onClick={() => (q.endsWith('…') ? setQuestion(q.slice(0, -1) + ' ') : void ask(q))}>{q}</button>)}</div>
        <label className="field">Your question
          <textarea value={question} onChange={(e) => setQuestion(e.target.value)} placeholder="e.g. Can I afford RM800 for a new mic?" /></label>
        <button className="primary" style={{ width: '100%' }} onClick={() => void ask()}>Ask Claude</button>
        {note && <p role="status" className="muted">{note}</p>}
        <p className="muted">Faster: ask in the Claude app with the Money connector on (see Plan setup notes).</p>
      </div>

      <h2>Apply Claude's changes</h2>
      <div className="card">
        <p className="muted">If Claude ends its reply with a <code>money-changes</code> block, copy the reply, then:</p>
        <button style={{ width: '100%' }} onClick={() => void pasteFromClipboard()}>Paste Claude's changes</button>
        <button className="link" onClick={() => setShowPaste(!showPaste)}>{showPaste ? 'Hide box' : 'Or paste into a box'}</button>
        {showPaste && (
          <>
            <textarea aria-label="Claude reply" value={pasted} onChange={(e) => setPasted(e.target.value)} placeholder="Paste Claude's reply here" />
            <button style={{ width: '100%', marginTop: 8 }} disabled={!pasted.trim()} onClick={() => parse(pasted)}>Preview changes</button>
          </>
        )}
        {errors.map((e) => <div key={e} className="banner err" style={{ borderRadius: 10, marginTop: 8 }} role="alert">{e}</div>)}
        {preview && (
          <div className="card proposal" role="group" aria-label="Proposed changes">
            <div className="muted">Proposed changes</div>
            {preview.summaries.map((s) => <b key={s} style={{ display: 'block' }}>{s}</b>)}
            {preview.diff.length > 0 && <ul className="muted">{preview.diff.map((d, i) => <li key={i}>{d}</li>)}</ul>}
            <div className="row"><button className="primary grow" onClick={apply}>Apply</button><button onClick={() => setPreview(null)}>Dismiss</button></div>
          </div>
        )}
      </div>

      {history.length > 0 && (
        <>
          <h2>Recent changes</h2>
          <div className="card">
            {history.map((h) => (
              <div key={h.id} className="item">
                <div className="grow">{h.set.summaries.join('; ')}<div className="muted">{new Date(h.at).toLocaleString()} · {h.set.status}</div></div>
                {h.set.status === 'applied' && <button onClick={() => undo(h)}>Undo</button>}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

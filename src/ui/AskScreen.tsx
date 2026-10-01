import { useCallback, useEffect, useRef, useState } from 'react';
import { useApp } from './app-data';
import { toast } from '../ui-kit';
import { store } from '../storage/store';
import { newId, type Data } from '../storage/actions';
import { Markdown } from './md';
import { AskSettings, loadSettings } from './AskSettings';
import { friendlyError, makeTransport, type AskSettings as Settings, type Block } from '../ai/anthropic';
import { runTurn, summarizeOlder, textOf, titleFrom, type StoredMsg, type Thread } from '../ai/chat';
import { applyProposal, undoProposal, UNDO_WINDOW_MS, type Proposal } from '../ai/proposals';
import { addSpend, costFooter, getSpend, overCap, usageCost, type Spend } from '../ai/cost';
import { todayKL } from '../ai/context';
import { demoTransport } from '../ai/demoTransport';
import { DEFAULT_SETTINGS } from '../ai/anthropic';

const QUICK = ['Am I on track this month?', 'Can I afford RM800 for a new mic?', 'What should I tweak next month?', 'Explain my last surprise'];
const WRITE_LABEL: Record<string, string> = {};
const chipLabel = (name: string, input: any) => `checked: ${name.replace(/^get_|^run_/, '').replace(/_/g, ' ')}${input?.id || input?.monthId ? ` ${input.id ?? input.monthId}` : ''}`;
void WRITE_LABEL;

/** Which thread is open survives tab switches (the thread itself is saved in the store). */
let activeId: string | null = null;

export function AskScreen() {
  const { snap, curId } = useApp();
  const demo = snap.demo;
  const today = todayKL();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [spend, setSpend] = useState<Spend>({ month: today.slice(0, 7), usd: 0 });
  const [thread, setThreadRaw] = useState<Thread | null>(() => {
    const ts = (store.getSnapshot().data.chats[curId]?.threads ?? []) as Thread[];
    return ts.find((t) => t.id === activeId) ?? null;
  });
  const setThread = (t: Thread | null) => { activeId = t?.id ?? null; setThreadRaw(t); };
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [streaming, setStreaming] = useState('');
  const [error, setError] = useState('');
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [showList, setShowList] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [, bump] = useState(0);
  const endRef = useRef<HTMLDivElement>(null);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => { void loadSettings().then((s) => { setSettings(s); setLoaded(true); }); void getSpend(today).then(setSpend); }, [today]);
  useEffect(() => {
    const on = () => setOnline(true), off = () => setOnline(false);
    window.addEventListener('online', on); window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [thread?.messages.length, streaming]);

  const chatFile = snap.data.chats[curId];
  const threads = (chatFile?.threads ?? []) as Thread[];

  const persist = useCallback((t: Thread) => {
    const others = ((store.getSnapshot().data.chats[curId]?.threads ?? []) as Thread[]).filter((x) => x.id !== t.id);
    store.dispatch({ type: 'putChats', file: { id: curId, threads: [...others, JSON.parse(JSON.stringify(t))] } });
  }, [curId]);

  const hasKey = demo || !!settings.apiKey;
  const capped = !demo && overCap(spend, settings.capUsd);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || busy) return;
    setError(''); setInput('');
    const t: Thread = thread ?? { id: newId('th'), title: titleFrom(msg), createdAt: new Date().toISOString(), messages: [], proposals: {} };
    t.messages.push({ role: 'user', content: msg });
    setThread(t); setBusy(true); setStreaming('');
    const transport = demo ? demoTransport : makeTransport(settings.apiKey);
    try {
      const { usage } = await runTurn({
        transport, model: settings.model, effort: settings.effort, today,
        getData: () => store.getSnapshot().data as Data, thread: t,
        events: { onText: (x) => setStreaming((s) => s + x), onTool: () => { setStreaming(''); bump((n) => n + 1); } },
      });
      setStreaming('');
      if (!demo) setSpend(await addSpend(today, usageCost(usage, settings.model)));
      if (!demo && t.messages.length > 40) await summarizeOlder(t, transport, settings.model).catch(() => {});
    } catch (e) {
      setError(friendlyError(e));
      // keep the thread consistent: drop a dangling user message that never got an answer
      if (t.messages[t.messages.length - 1].role === 'user' && typeof t.messages[t.messages.length - 1].content === 'string') { /* keep so the user can retry */ }
    } finally {
      setBusy(false); setStreaming('');
      setThread({ ...t });
      persist(t);
    }
  };

  const attach = async (f: File) => {
    try {
      const { parseWorkbook, readWorkbook } = await import('../import/excel');
      const r = parseWorkbook(readWorkbook(await f.arrayBuffer()), f.name);
      const rows = r.rows.map((x) => ({ name: x.name, amount: x.amount, rule: x.rule.type, pocket: x.kind, flags: x.flags }));
      await send(`📎 ${f.name}\nCompare this workbook with my plan.\n\`\`\`json\n${JSON.stringify({ takeHome: r.inputs.takeHome, rows, warnings: r.warnings })}\n\`\`\``);
    } catch (e) { setError((e as Error).message); }
  };

  const updateProposal = (p: Proposal, extra?: StoredMsg) => {
    if (!thread) return;
    const t = { ...thread, proposals: { ...thread.proposals, [p.id]: p }, messages: extra ? [...thread.messages, extra] : thread.messages };
    setThread(t); persist(t);
  };
  const apply = (p: Proposal) => {
    try {
      const next = applyProposal(p, store.getSnapshot().data as Data, (a) => store.dispatch(a));
      updateProposal(next, { role: 'user', note: true, content: `[System: Shaq tapped Apply. "${p.summary}" was saved. Fresh data is in the snapshot on your next turn.]` });
      toast('Applied');
    } catch (e) { toast((e as Error).message); }
  };
  const undo = (p: Proposal) => {
    if (p.appliedAt && Date.now() - p.appliedAt > UNDO_WINDOW_MS && !confirm('Undo restores the files as they were before this change. Anything changed since will be lost. Continue?')) return;
    try {
      updateProposal(undoProposal(p, (a) => store.dispatch(a)), { role: 'user', note: true, content: `[System: Shaq undid "${p.summary}". It is no longer applied.]` });
      toast('Undone');
    } catch (e) { toast((e as Error).message); }
  };
  const dismiss = (p: Proposal) => updateProposal({ ...p, status: 'dismissed' }, { role: 'user', note: true, content: `[System: Shaq dismissed the proposal "${p.summary}".]` });

  if (!loaded) return <p className="muted">Loading…</p>;
  if (!hasKey) {
    return (
      <>
        <h1>Ask</h1>
        <div className="card">
          <h3>Set up Ask (3 minutes)</h3>
          <ol className="muted" style={{ paddingLeft: 18 }}>
            <li>platform.claude.com → create a workspace "money-tracker" and set a monthly spend limit (US$10 suggested).</li>
            <li>Add a few dollars of credit, then create an API key in that workspace.</li>
            <li>Paste it below and tap Test.</li>
          </ol>
          <AskSettings onChange={setSettings} />
        </div>
      </>
    );
  }

  const msgs = thread?.messages ?? [];
  return (
    <div className="chat">
      <div className="row between">
        <h1>Ask</h1>
        <div className="row">
          {threads.length > 0 && <button className="link" onClick={() => setShowList(!showList)}>Chats</button>}
          <button className="link" onClick={() => { setThread(null); setShowList(false); }}>New</button>
          {!demo && <button className="link" onClick={() => setShowSettings(!showSettings)}>Settings</button>}
        </div>
      </div>
      {showSettings && <div className="card"><AskSettings onChange={setSettings} /></div>}
      {showList && (
        <div className="card">
          {[...threads].reverse().map((t) => (
            <button key={t.id} className="amt" style={{ width: '100%', textAlign: 'left' }} onClick={() => { setThread(t); setShowList(false); }}>{t.title}<div className="muted">{t.createdAt.slice(0, 10)}</div></button>
          ))}
        </div>
      )}

      {msgs.length === 0 && (
        <div className="card">
          <p>Ask about your plan, funds and history. I only use your real numbers, and I can propose changes for you to apply.</p>
          <div className="chips">{QUICK.map((q) => <button key={q} className="chip" disabled={busy || !online || capped} onClick={() => void send(q)}>{q}</button>)}</div>
        </div>
      )}

      {msgs.map((m, i) => <Message key={i} m={m} thread={thread!} onApply={apply} onDismiss={dismiss} onUndo={undo} model={settings.model} />)}
      {busy && (
        <div className="bubble ai" aria-live="polite">{streaming ? <Markdown text={streaming} /> : <span className="muted">Thinking…</span>}</div>
      )}
      {error && <div className="banner err" style={{ borderRadius: 10 }} role="alert">{error}</div>}
      {capped && <div className="banner" style={{ borderRadius: 10 }}>Monthly cap of US${settings.capUsd} reached. Ask is off until next month, or raise the cap in Settings.</div>}
      <div ref={endRef} />

      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <input ref={file} type="file" hidden accept=".xlsx,.xls,.xlsm" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void attach(f); }} />
        <button type="button" aria-label="Attach Excel" disabled={busy || !online} onClick={() => file.current?.click()}>📎</button>
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={online ? 'Ask anything about your money…' : 'Ask needs internet'} disabled={!online || capped} aria-label="Message" />
        <button className="primary" type="submit" disabled={busy || !online || capped || !input.trim()}>Send</button>
      </form>
    </div>
  );
}

function Message({ m, thread, onApply, onDismiss, onUndo, model }: {
  m: StoredMsg; thread: Thread; onApply: (p: Proposal) => void; onDismiss: (p: Proposal) => void; onUndo: (p: Proposal) => void; model: string;
}) {
  if (m.note) return <div className="muted" style={{ textAlign: 'center', fontSize: '0.78rem' }}>{typeof m.content === 'string' ? m.content.replace(/^\[System: |\]$/g, '') : ''}</div>;
  if (m.role === 'user') {
    if (typeof m.content !== 'string') return null; // tool results are shown as chips on the assistant message
    const first = m.content.startsWith('📎') ? m.content.split('\n')[0] : m.content;
    return <div className="bubble me">{first}</div>;
  }
  const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content } as Block] : m.content;
  const text = textOf(m);
  const uses = blocks.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
  return (
    <div>
      {text && <div className="bubble ai"><Markdown text={text} /></div>}
      {uses.map((u) => {
        const p = thread.proposals[`p-${u.id}`];
        if (p) return <ProposalCard key={u.id} p={p} onApply={onApply} onDismiss={onDismiss} onUndo={onUndo} />;
        const failed = thread.messages.some((x) => Array.isArray(x.content) && x.content.some((b) => b.type === 'tool_result' && b.tool_use_id === u.id && b.is_error));
        return <span key={u.id} className={`pill toolchip${failed ? ' bad' : ''}`}>{failed ? 'could not apply: ' : ''}{chipLabel(u.name, u.input)}</span>;
      })}
      {m.usage && text && <div className="muted foot">{costFooter(m.usage, m.model ?? model)}</div>}
    </div>
  );
}

function ProposalCard({ p, onApply, onDismiss, onUndo }: { p: Proposal; onApply: (p: Proposal) => void; onDismiss: (p: Proposal) => void; onUndo: (p: Proposal) => void }) {
  return (
    <div className="card proposal" role="group" aria-label="Proposed change">
      <div className="muted">Proposed change</div>
      <b>{p.summary}</b>
      {p.diff.length > 0 && <ul className="muted">{p.diff.map((d, i) => <li key={i}>{d}</li>)}</ul>}
      {p.status === 'pending' && <div className="row"><button className="primary grow" onClick={() => onApply(p)}>Apply</button><button onClick={() => onDismiss(p)}>Dismiss</button></div>}
      {p.status === 'applied' && <div className="row between"><span style={{ color: 'var(--green)' }}>✓ Applied</span><button onClick={() => onUndo(p)}>Undo</button></div>}
      {p.status === 'dismissed' && <div className="muted">Dismissed</div>}
      {p.status === 'undone' && <div className="muted">Undone</div>}
    </div>
  );
}

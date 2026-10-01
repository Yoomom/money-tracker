import { useEffect, useState } from 'react';
import { useApp } from './ui/app-data';
import { Toaster } from './ui-kit';
import { store } from './storage/store';
import { ConnectScreen } from './ui/ConnectScreen';
import { ImportScreen } from './ui/ImportScreen';
import { MonthScreen } from './ui/MonthScreen';
import { PaydayScreen } from './ui/PaydayScreen';
import { FundsScreen } from './ui/FundsScreen';
import { PlanScreen } from './ui/PlanScreen';
import { SurpriseSheet } from './ui/SurpriseSheet';
import { ReviewScreen } from './ui/ReviewScreen';
import { HistoryScreen } from './ui/HistoryScreen';

type Tab = 'month' | 'payday' | 'funds' | 'plan';
type Overlay = null | 'review' | 'history' | 'import' | 'surprise';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'month', label: 'Month', icon: '◔' }, { id: 'payday', label: 'Payday', icon: '☑' },
  { id: 'funds', label: 'Funds', icon: '◈' }, { id: 'plan', label: 'Plan', icon: '⚙' },
];

export default function App() {
  const { snap, config, month, curId } = useApp();
  const [tab, setTab] = useState<Tab>('month');
  const [overlay, setOverlay] = useState<Overlay>(null);

  // Open this month automatically (first run, and every new month).
  useEffect(() => {
    if (config && !month && snap.ready && (snap.demo || !snap.needsSetup)) store.dispatch({ type: 'openMonth', id: curId });
  }, [config, month, curId, snap.ready, snap.demo, snap.needsSetup]);

  // Flush edits when we come back online or return to the app.
  useEffect(() => {
    const go = () => { if (document.visibilityState !== 'hidden') void store.refresh(); };
    const online = () => void store.flush();
    window.addEventListener('online', online);
    document.addEventListener('visibilitychange', go);
    return () => { window.removeEventListener('online', online); document.removeEventListener('visibilitychange', go); };
  }, []);

  if (!snap.ready) return <div className="app"><p className="muted">Loading…</p></div>;
  if (!snap.conn && !snap.demo) return <><ConnectScreen /><Toaster /></>;
  if (!config) {
    if (snap.needsSetup) return <><div className="app"><h1>Set up your plan</h1><p className="muted">No plan found in your data repo yet.</p></div><ImportScreen onBack={() => {}} onDone={() => {}} /><Toaster /></>;
    return <div className="app"><h1>Money Tracker</h1><p className="muted">{snap.status === 'error' ? snap.error : 'Loading your plan…'}</p></div>;
  }

  const banner = snap.demo ? { text: 'Demo data — dummy numbers, nothing is saved', err: false }
    : snap.status === 'conflict' ? { text: snap.error ?? 'Changed elsewhere — reload', err: true }
    : snap.status === 'error' ? { text: `Not saved: ${snap.error}`, err: true }
    : snap.status === 'offline' || (snap.pendingCount > 0 && typeof navigator !== 'undefined' && !navigator.onLine) ? { text: `Offline — ${snap.pendingCount} unsynced edit${snap.pendingCount === 1 ? '' : 's'}`, err: false }
    : snap.pendingCount > 0 ? { text: `Unsynced — ${snap.pendingCount} edit${snap.pendingCount === 1 ? '' : 's'} saving…`, err: false }
    : null;

  return (
    <>
      {banner && <div className={`banner${banner.err ? ' err' : ''}`} role="status">
        {banner.text}
        {snap.status === 'conflict' && <button className="link" onClick={() => void store.discardPendingAndReload()}>Reload</button>}
      </div>}
      <main className="app">
        {tab === 'month' && <MonthScreen onReview={() => setOverlay('review')} onHistory={() => setOverlay('history')} />}
        {tab === 'payday' && <PaydayScreen />}
        {tab === 'funds' && <FundsScreen />}
        {tab === 'plan' && <PlanScreen onImport={() => setOverlay('import')} />}
      </main>
      {(tab === 'month' || tab === 'funds') && month?.status === 'open' && (
        <button className="primary fab" onClick={() => setOverlay('surprise')}>＋ Log a surprise</button>
      )}
      <nav className="tabbar" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} aria-current={tab === t.id ? 'page' : undefined} onClick={() => setTab(t.id)}>
            <span aria-hidden>{t.icon}</span>{t.label}
          </button>
        ))}
      </nav>
      {overlay === 'surprise' && <SurpriseSheet onClose={() => setOverlay(null)} />}
      {overlay === 'review' && <ReviewScreen onBack={() => setOverlay(null)} />}
      {overlay === 'history' && <HistoryScreen onBack={() => setOverlay(null)} />}
      {overlay === 'import' && <ImportScreen onBack={() => setOverlay(null)} onDone={() => setOverlay(null)} />}
      <Toaster />
    </>
  );
}

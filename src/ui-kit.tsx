import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { store } from './storage/store';
import { parseNum } from './domain/util';

export const useSnap = () => useSyncExternalStore(store.subscribe, store.getSnapshot);

/** Number input that commits on blur / Enter instead of every keystroke. */
export function NumInput({ value, onCommit, step = 'any', className, placeholder, allowNegative, autoFocus }: {
  value: number | undefined; onCommit: (n: number | undefined) => void; step?: string; className?: string;
  placeholder?: string; allowNegative?: boolean; autoFocus?: boolean;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => setText(value == null ? '' : String(value)), [value]);
  const commit = () => {
    if (text.trim() === '') return onCommit(undefined);
    const n = parseNum(text);
    if (n != null && (allowNegative || n >= 0)) onCommit(n); else setText(value == null ? '' : String(value));
  };
  return (
    <input className={className} inputMode={allowNegative ? 'text' : 'decimal'} step={step} value={text} placeholder={placeholder}
      autoFocus={autoFocus} onChange={(e) => setText(e.target.value)} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
  );
}

export function TextInput({ value, onCommit, placeholder }: { value: string; onCommit: (s: string) => void; placeholder?: string }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return <input value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} onBlur={() => text !== value && onCommit(text)}
    onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="sheet-bg" onClick={onClose}>
      <div className="sheet" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="row between"><h1>{title}</h1><button className="link" onClick={onClose}>Close</button></div>
        {children}
      </div>
    </div>
  );
}

export function Screen({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  return (
    <div className="screen">
      <div className="app">
        <div className="row"><button className="link" onClick={onBack}>← Back</button></div>
        <h1>{title}</h1>
        {children}
      </div>
    </div>
  );
}

export const Bar = ({ value, max }: { value: number; max: number }) => (
  <div className={`bar${value > max + 0.005 ? ' over' : ''}`}><i style={{ width: `${max > 0 ? Math.min(100, Math.max(0, (value / max) * 100)) : 0}%` }} /></div>
);

let toastTimer: ReturnType<typeof setTimeout>;
const toastListeners = new Set<(m: string) => void>();
export const toast = (m: string) => toastListeners.forEach((l) => l(m));
export function Toaster() {
  const [msg, setMsg] = useState('');
  useEffect(() => {
    const l = (m: string) => { setMsg(m); clearTimeout(toastTimer); toastTimer = setTimeout(() => setMsg(''), 3500); };
    toastListeners.add(l);
    return () => void toastListeners.delete(l);
  }, []);
  return msg ? <div className="toast" role="status">{msg}</div> : null;
}

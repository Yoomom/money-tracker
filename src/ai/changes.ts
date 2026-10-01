import type { Config, Month } from '../domain/types';
import { apply, pathsOf, type Action, type Data } from '../storage/actions';
import { diffLines, isWriteTool, planWriteTool, ToolError } from './tools';

/** The only ways data can change. Each type is one write tool in tools.ts. */
export type Change = { type: string; [k: string]: unknown };
export interface UndoSnapshot { config?: Config; months: Record<string, Month> }
export interface ChangeSet {
  changes: Change[]; summaries: string[]; actions: Action[]; diff: string[];
  status: 'pending' | 'applied' | 'undone'; appliedAt?: number; undo?: UndoSnapshot;
}

/** Pull the `money-changes` fenced block out of a pasted Claude reply (or accept a bare JSON array). */
export function extractChanges(text: string): { changes?: Change[]; error?: string } {
  const fences = [...text.matchAll(/```\s*money-changes\s*\n([\s\S]*?)```/gi)];
  const fence = fences.length ? fences[fences.length - 1] : null; // the last block is Claude's answer
  const raw = fence ? fence[1] : /^\s*\[[\s\S]*\]\s*$/.test(text) ? text : null;
  if (raw == null) return { error: 'No money-changes block found in that text.' };
  let parsed: unknown;
  try { parsed = JSON.parse(raw.trim()); } catch { return { error: 'The money-changes block is not valid JSON.' }; }
  if (!Array.isArray(parsed) || !parsed.length) return { error: 'The money-changes block must be a non-empty JSON array.' };
  for (const c of parsed) if (!c || typeof c !== 'object' || typeof (c as any).type !== 'string') return { error: 'Every change needs a "type".' };
  return { changes: parsed as Change[] };
}

/** Validate every change in order against the data as it would be after the previous ones. */
export function buildChangeSet(changes: Change[], d: Data, today: string): { set?: ChangeSet; errors: string[] } {
  const errors: string[] = [];
  const summaries: string[] = [];
  const actions: Action[] = [];
  let cur = d;
  changes.forEach((ch, i) => {
    const { type, ...args } = ch;
    const name = type === 'set_actual_income' ? 'set_income' : type;
    try {
      if (!isWriteTool(name)) throw new ToolError(`Unknown change type "${type}".`);
      const draft = planWriteTool(name, args, cur, today);
      cur = draft.actions.reduce(apply, cur);
      summaries.push(draft.summary);
      actions.push(...draft.actions);
    } catch (e) {
      if (!(e instanceof ToolError)) throw e;
      errors.push(`Change ${i + 1} (${type}): ${e.message}`);
    }
  });
  if (errors.length) return { errors };
  return { errors, set: { changes, summaries, actions, diff: diffLines(d, cur, today), status: 'pending' } };
}

/** Snapshot of every file the actions touch, so they can be undone exactly. */
export function snapshotFor(actions: Action[], d: Data): UndoSnapshot {
  const snap: UndoSnapshot = { months: {} };
  for (const p of new Set(actions.flatMap(pathsOf))) {
    if (p === 'config.json' && d.config) snap.config = d.config;
    else if (p.startsWith('months/')) { const m = d.months[p.slice(7, -5)]; if (m) snap.months[m.id] = m; }
  }
  return snap;
}

/** The inverse of a change set, as a single restore action. */
export const inverse = (snap: UndoSnapshot, label: string): Action => ({ type: 'restoreData', config: snap.config, months: snap.months, label });

export const commitLabel = (prefix: string, summaries: string[]) => `${prefix}: ${summaries.join('; ')}`.slice(0, 200);

type Dispatch = (a: Action) => void;
export function applyChangeSet(s: ChangeSet, d: Data, dispatch: Dispatch, now = Date.now()): ChangeSet {
  if (s.status !== 'pending') throw new ToolError('Already applied.');
  const undo = snapshotFor(s.actions, d);
  const label = commitLabel('ask', s.summaries);
  for (const a of s.actions) dispatch({ ...a, label });
  return { ...s, status: 'applied', appliedAt: now, undo };
}
export function undoChangeSet(s: ChangeSet, dispatch: Dispatch): ChangeSet {
  if (s.status !== 'applied' || !s.undo) throw new ToolError('Nothing to undo.');
  dispatch(inverse(s.undo, commitLabel('ask: undo', s.summaries)));
  return { ...s, status: 'undone' };
}
export const UNDO_WINDOW_MS = 30_000;

import type { Config, Month } from '../domain/types';
import { apply, pathsOf, type Action, type Data } from '../storage/actions';
import { diffLines, planWriteTool, ToolError } from './tools';

export interface UndoSnapshot { config?: Config; months: Record<string, Month> }
export interface Proposal {
  id: string; toolUseId: string; tool: string; summary: string; actions: Action[]; diff: string[];
  status: 'pending' | 'applied' | 'dismissed' | 'undone'; appliedAt?: number; undo?: UndoSnapshot;
}

/** Validate a write tool call and build a proposal. Throws ToolError for invalid or unbalanced changes. */
export function makeProposal(toolUseId: string, tool: string, input: unknown, d: Data, today: string): Proposal {
  const draft = planWriteTool(tool, input, d, today);
  const after = draft.actions.reduce(apply, d);
  return { id: `p-${toolUseId}`, toolUseId, tool, summary: draft.summary, actions: draft.actions, diff: diffLines(d, after, today), status: 'pending' };
}

/** Snapshot of everything the actions touch, so it can be restored exactly. */
export function snapshotFor(actions: Action[], d: Data): UndoSnapshot {
  const paths = new Set(actions.flatMap(pathsOf));
  const snap: UndoSnapshot = { months: {} };
  for (const p of paths) {
    if (p === 'config.json' && d.config) snap.config = d.config;
    else if (p.startsWith('months/')) { const m = d.months[p.slice(7, -5)]; if (m) snap.months[m.id] = m; }
  }
  return snap;
}

type Dispatch = (a: Action) => void;

export function applyProposal(p: Proposal, d: Data, dispatch: Dispatch, now = Date.now()): Proposal {
  if (p.status !== 'pending') throw new ToolError('Already handled.');
  const undo = snapshotFor(p.actions, d);
  for (const a of p.actions) dispatch({ ...a, label: `chat: ${p.summary}` });
  return { ...p, status: 'applied', appliedAt: now, undo };
}

export function undoProposal(p: Proposal, dispatch: Dispatch): Proposal {
  if (p.status !== 'applied' || !p.undo) throw new ToolError('Nothing to undo.');
  dispatch({ type: 'restoreData', config: p.undo.config, months: p.undo.months, label: `chat: undo "${p.summary}"` });
  return { ...p, status: 'undone' };
}

export const UNDO_WINDOW_MS = 30_000;

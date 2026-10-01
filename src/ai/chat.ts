import type { Data } from '../storage/actions';
import { makeProposal, type Proposal } from './proposals';
import { buildSnapshot } from './context';
import { SYSTEM_PROMPT } from './systemPrompt';
import { isWriteTool, runReadTool, TOOL_DEFS, ToolError } from './tools';
import { addUsage, type Usage } from './cost';
import type { ApiMessage, Block, Transport } from './anthropic';

export interface StoredMsg {
  role: 'user' | 'assistant'; content: string | Block[];
  usage?: Usage; model?: string;
  /** a small system-ish note shown in the thread, e.g. "Applied: …" */
  note?: boolean;
}
export interface Thread {
  id: string; title: string; createdAt: string; messages: StoredMsg[];
  proposals: Record<string, Proposal>; summary?: string; summarizedUpTo?: number;
}

export const MAX_ROUNDS = 8;
export const KEEP_MESSAGES = 30;
export const MAX_TOKENS = 8000;

export function systemBlocks(d: Data, today: string) {
  return [
    { type: 'text', text: SYSTEM_PROMPT },
    { type: 'text', text: `DATA SNAPSHOT (JSON, current)\n${buildSnapshot(d, today)}`, cache_control: { type: 'ephemeral' } },
  ];
}

/** The messages we send: summary of older turns + the last KEEP_MESSAGES, never starting mid tool exchange. */
export function windowMessages(t: Thread): ApiMessage[] {
  const clean = t.messages.map((m): ApiMessage => ({ role: m.role, content: m.content }));
  let start = Math.max(0, clean.length - KEEP_MESSAGES);
  // an API conversation must begin with a plain user message (not a tool_result)
  while (start < clean.length && !(clean[start].role === 'user' && (typeof clean[start].content === 'string' || !(clean[start].content as Block[]).some((b) => b.type === 'tool_result')))) start++;
  const out = clean.slice(start);
  if (t.summary && start > 0) out.unshift({ role: 'user', content: `[Summary of the earlier conversation: ${t.summary}]` }, { role: 'assistant', content: 'Understood.' });
  return out;
}

export interface TurnEvents {
  onText: (t: string) => void;
  onTool?: (name: string, input: unknown) => void;
}
export interface TurnParams {
  transport: Transport; model: string; effort?: string; today: string;
  getData: () => Data; thread: Thread; events: TurnEvents; signal?: AbortSignal;
}

/** Run one user turn: stream, execute read tools automatically, turn write tools into proposals. Mutates `thread`. */
export async function runTurn(p: TurnParams): Promise<{ usage: Usage }> {
  let total: Usage = {};
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const d = p.getData();
    const res = await p.transport(
      { model: p.model, max_tokens: MAX_TOKENS, system: systemBlocks(d, p.today), tools: TOOL_DEFS, messages: windowMessages(p.thread), effort: p.effort },
      p.events.onText, p.signal,
    );
    total = addUsage(total, res.usage);
    p.thread.messages.push({ role: 'assistant', content: res.content, usage: res.usage, model: p.model });
    const uses = res.content.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (res.stop_reason !== 'tool_use' || !uses.length) break;

    const results: Block[] = uses.map((u) => {
      p.events.onTool?.(u.name, u.input);
      try {
        if (isWriteTool(u.name)) {
          const prop = makeProposal(u.id, u.name, u.input, p.getData(), p.today);
          p.thread.proposals[prop.id] = prop;
          return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify({ status: 'proposed', summary: prop.summary, effects: prop.diff, note: 'Not saved yet. Shaq must tap Apply.' }) };
        }
        return { type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(runReadTool(u.name, u.input, p.getData(), p.today)) };
      } catch (e) {
        if (!(e instanceof ToolError)) throw e;
        return { type: 'tool_result', tool_use_id: u.id, content: e.message, is_error: true };
      }
    });
    p.thread.messages.push({ role: 'user', content: results });
    if (round === MAX_ROUNDS - 1) p.thread.messages.push({ role: 'assistant', content: [{ type: 'text', text: '(Stopped after 8 tool rounds. Ask me to continue if needed.)' }] });
  }
  return { usage: total };
}

export const textOf = (m: StoredMsg) =>
  typeof m.content === 'string' ? m.content : m.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('\n');

export const titleFrom = (s: string) => (s.length > 48 ? `${s.slice(0, 45)}…` : s);

/** Summarise everything older than the window with a cheap call. */
export async function summarizeOlder(t: Thread, transport: Transport, model: string): Promise<void> {
  const cut = Math.max(0, t.messages.length - KEEP_MESSAGES);
  if (cut <= (t.summarizedUpTo ?? 0) + 10) return;
  const text = t.messages.slice(0, cut).map((m) => `${m.role}: ${textOf(m)}`).filter((l) => l.length > 8).join('\n').slice(-12000);
  const r = await transport({ model, max_tokens: 500, system: 'Summarise this money-coaching conversation in under 150 words. Keep amounts, decisions and open questions.', messages: [{ role: 'user', content: text }], effort: 'low' }, () => {});
  t.summary = r.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join('');
  t.summarizedUpTo = cut;
}

import type { Usage } from './cost';

export type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: any }
  | { type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }
  | { type: 'thinking'; thinking: string; signature: string }
  | { type: 'redacted_thinking'; data: string };
export interface ApiMessage { role: 'user' | 'assistant'; content: string | Block[] }

export interface AskSettings { apiKey: string; model: string; effort: 'low' | 'medium' | 'high'; capUsd: number }
export const DEFAULT_SETTINGS: AskSettings = { apiKey: '', model: 'claude-sonnet-5-5', effort: 'medium', capUsd: 5 };

export class ApiError extends Error { constructor(public status: number, message: string) { super(message); } }
export interface StreamResult { content: Block[]; stop_reason: string; usage: Usage }
export interface StreamRequest {
  model: string; max_tokens: number; system: unknown; tools?: unknown; messages: ApiMessage[]; effort?: string; stream?: boolean;
}
/** Injectable so tests and ?demo=1 can fake the network. */
export type Transport = (req: StreamRequest, onText: (t: string) => void, signal?: AbortSignal) => Promise<StreamResult>;

const URL = 'https://api.anthropic.com/v1/messages';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'API key invalid, check Settings.';
    if (e.status === 429 || e.status === 529) return 'Claude is busy or rate limited. Try again in a minute.';
    return `Claude API error ${e.status}: ${e.message}`;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) return 'Ask needs internet.';
  return (e as Error).message || 'Something went wrong.';
}

/** Parse an SSE stream of Messages API events into content blocks. */
export async function readStream(body: ReadableStream<Uint8Array>, onText: (t: string) => void): Promise<StreamResult> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  const blocks: (Block & { _json?: string })[] = [];
  const usage: Usage = {};
  let stop = 'end_turn';
  let buf = '';
  const handle = (data: string) => {
    let ev: any;
    try { ev = JSON.parse(data); } catch { return; }
    switch (ev.type) {
      case 'message_start': Object.assign(usage, ev.message?.usage ?? {}); break;
      case 'content_block_start': {
        const b = ev.content_block;
        blocks[ev.index] = b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: {}, _json: '' }
          : b.type === 'thinking' ? { type: 'thinking', thinking: b.thinking ?? '', signature: b.signature ?? '' }
          : b.type === 'redacted_thinking' ? { type: 'redacted_thinking', data: b.data }
          : { type: 'text', text: b.text ?? '' };
        break;
      }
      case 'content_block_delta': {
        const b = blocks[ev.index] as any;
        if (!b) break;
        if (ev.delta.type === 'text_delta') { b.text += ev.delta.text; onText(ev.delta.text); }
        else if (ev.delta.type === 'input_json_delta') b._json += ev.delta.partial_json;
        else if (ev.delta.type === 'thinking_delta') b.thinking += ev.delta.thinking;
        else if (ev.delta.type === 'signature_delta') b.signature = (b.signature ?? '') + ev.delta.signature;
        break;
      }
      case 'content_block_stop': {
        const b = blocks[ev.index] as any;
        if (b?.type === 'tool_use') { try { b.input = b._json ? JSON.parse(b._json) : {}; } catch { b.input = {}; } delete b._json; }
        break;
      }
      case 'message_delta':
        if (ev.delta?.stop_reason) stop = ev.delta.stop_reason;
        if (ev.usage) Object.assign(usage, ev.usage);
        break;
      case 'error': throw new ApiError(ev.error?.type === 'overloaded_error' ? 529 : 500, ev.error?.message ?? 'stream error');
    }
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (line) handle(line.slice(5).trim());
    }
  }
  // empty text blocks are rejected by the API when sent back
  return { content: blocks.filter((b) => b && !(b.type === 'text' && !b.text)) as Block[], stop_reason: stop, usage };
}

export function makeTransport(apiKey: string, fetchFn: typeof fetch = (...a) => fetch(...a)): Transport {
  return async (req, onText, signal) => {
    const body: any = { model: req.model, max_tokens: req.max_tokens, stream: true, system: req.system, messages: req.messages };
    if (req.tools) body.tools = req.tools;
    if (req.effort) body.output_config = { effort: req.effort };
    let lastErr: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt) await sleep(800 * 2 ** attempt);
      let res: Response;
      try {
        res = await fetchFn(URL, {
          method: 'POST', signal,
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify(body),
        });
      } catch (e) { throw (signal?.aborted ? e : new ApiError(0, 'Ask needs internet.')); }
      if (res.ok && res.body) return readStream(res.body, onText);
      const msg = await res.text().catch(() => '');
      let detail = msg;
      try { detail = JSON.parse(msg).error?.message ?? msg; } catch { /* keep raw */ }
      // An older model/effort combination may reject output_config: retry once without it.
      if (res.status === 400 && body.output_config && /output_config|effort/i.test(detail)) { delete body.output_config; attempt--; continue; }
      lastErr = new ApiError(res.status, detail);
      if (res.status !== 429 && res.status !== 529) throw lastErr;
    }
    throw lastErr;
  };
}

/** Tiny non-streaming-style call (key test, summaries): resolves with the text. */
export async function quickCall(transport: Transport, model: string, prompt: string, effort?: string): Promise<{ text: string; usage: Usage }> {
  const r = await transport({ model, max_tokens: 300, system: 'Reply briefly.', messages: [{ role: 'user', content: prompt }], effort }, () => {});
  return { text: r.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text').map((b) => b.text).join(''), usage: r.usage };
}

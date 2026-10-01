import { describe, expect, it, vi } from 'vitest';
import seed from '../seed.example.json';
import type { Config } from '../domain/types';
import { apply, emptyData, type Action, type Data } from '../storage/actions';
import { buildSnapshot, approxTokens } from './context';
import { runReadTool, planWriteTool, ToolError, TOOL_DEFS, isWriteTool } from './tools';
import { applyProposal, makeProposal, undoProposal } from './proposals';
import { usageCost, costFooter } from './cost';
import { readStream, makeTransport, type StreamResult, type Transport } from './anthropic';
import { runTurn, windowMessages, systemBlocks, type Thread } from './chat';
import { fundBalance } from '../domain/funds';
import { monthUnallocated } from '../domain/month';

const TODAY = '2026-10-08';
const config = seed as unknown as Config;
const base = (): Data => {
  let d = apply(emptyData(), { type: 'setConfig', config, message: 'x' });
  d = apply(d, { type: 'openMonth', id: '2026-10' });
  return d;
};
const dispatcher = (d: { cur: Data }) => (a: Action) => { d.cur = apply(d.cur, a); };

describe('context snapshot', () => {
  it('has no secrets and fits well under 60k tokens', () => {
    const d = base();
    const s = buildSnapshot(d, TODAY);
    expect(s).not.toMatch(/github_pat|ghp_|gho_|sk-ant|apiKey|token/i);
    expect(approxTokens(s)).toBeLessThan(60000);
    const j = JSON.parse(s);
    expect(j.today).toBe(TODAY);
    expect(j.fundBalances.length).toBe(config.funds.length);
    expect(j.currentMonthHealth).toHaveLength(12);
  });
});

describe('read tools', () => {
  const d = base();
  it('get_month / list_months / balances / health', () => {
    expect((runReadTool('get_month', {}, d, TODAY) as any).id).toBe('2026-10');
    expect(() => runReadTool('get_month', { id: '2025-01' }, d, TODAY)).toThrow(ToolError);
    expect((runReadTool('list_months', {}, d, TODAY) as any[])[0].id).toBe('2026-10');
    expect((runReadTool('get_fund_balances', {}, d, TODAY) as any[]).find((f) => f.id === 'emergency').balance).toBe(3000);
    expect(runReadTool('run_health', {}, d, TODAY) as any[]).toHaveLength(12);
  });
  it('simulate_purchase from a fund and by instalment', () => {
    const r: any = runReadTool('simulate_purchase', { rm: 800, from: 'emergency' }, d, TODAY);
    expect(r.balanceAfter).toBe(2200);
    expect(r.emergencyMonthsAfter).toBeLessThan(r.emergencyMonthsBefore);
    const i: any = runReadTool('simulate_purchase', { rm: 1200, from: 'instalment', months: 12 }, d, TODAY);
    expect(i.monthlyPayment).toBe(100);
    expect(i.fitsInRemainder).toBe(true);
  });
  it('every write tool is flagged as a write', () => {
    for (const t of TOOL_DEFS) expect(isWriteTool(t.name)).toBe(!/^(get_|list_|run_|simulate_)/.test(t.name));
  });
});

describe('write tools and the balanced-plan rule', () => {
  const d = base();
  it('log_surprise validates the source', () => {
    expect(() => planWriteTool('log_surprise', { date: TODAY, what: 'x', rm: 5, paidFrom: 'nope' }, d, TODAY)).toThrow(/Unknown source/);
    const w = planWriteTool('log_surprise', { date: TODAY, what: 'Car service', rm: 350, paidFrom: 'car-wear' }, d, TODAY);
    expect(w.actions[0].type).toBe('logSurprise');
  });
  it('update_item_rule rebalances through the remainder and rejects overspend', () => {
    const ok = makeProposal('t1', 'update_item_rule', { itemId: 'charity', rule: { type: 'percentOfIncome', pct: 0.03 } }, d, TODAY);
    expect(ok.diff.join('\n')).toMatch(/Charity/);
    const after = ok.actions.reduce(apply, d);
    expect(monthUnallocated(after.months['2026-10'], after.config!)).toBe(0);
    expect(after.config!.givingPct).toBe(0.03);
    expect(() => planWriteTool('update_item_rule', { itemId: 'food', rule: { type: 'fixed', rm: 5000 } }, d, TODAY)).toThrow(/over take-home/);
    expect(() => planWriteTool('remove_item', { itemId: 'invest' }, d, TODAY)).toThrow(/remainder/);
    expect(() => planWriteTool('update_item_rule', { itemId: 'food', rule: { type: 'remainder' } }, d, TODAY)).toThrow(/already/);
  });
  it('add_item, move_between_funds, mark_payday_item, notes, income', () => {
    expect(() => planWriteTool('add_item', { pocketId: 'guiltfree', name: 'Gym', rule: { type: 'fixed', rm: 99999 } }, d, TODAY)).toThrow(ToolError);
    const add = planWriteTool('add_item', { pocketId: 'guiltfree', name: 'Gym', rule: { type: 'fixed', rm: 60 } }, d, TODAY);
    expect(add.actions[0].type).toBe('setConfig');
    const mv = makeProposal('t2', 'move_between_funds', { from: 'emergency', to: 'gifts', rm: 100, reason: 'top up' }, d, TODAY);
    expect(mv.actions).toHaveLength(2);
    const after = mv.actions.reduce(apply, d);
    expect(fundBalance(config.funds[2], Object.values(after.months))).toBe(100);
    expect(planWriteTool('mark_payday_item', { itemId: 'charity', done: true }, d, TODAY).actions[0].type).toBe('tick');
    expect(planWriteTool('add_month_note', { text: 'hi' }, d, TODAY).actions[0].type).toBe('addNote');
    expect(planWriteTool('set_actual_income', { source: 'salary', rm: 4250 }, d, TODAY).actions[0].type).toBe('setSalary');
  });
});

describe('proposal apply and undo', () => {
  it('apply changes funds; undo restores the exact earlier data', () => {
    const state = { cur: base() };
    const before = state.cur;
    const p = makeProposal('t3', 'log_surprise', { date: TODAY, what: 'Car service', rm: 350, paidFrom: 'car-wear' }, state.cur, TODAY);
    const applied = applyProposal(p, state.cur, dispatcher(state), 1000);
    expect(applied.status).toBe('applied');
    expect(fundBalance(config.funds[1], Object.values(state.cur.months))).toBe(-350);
    const undone = undoProposal(applied, dispatcher(state));
    expect(undone.status).toBe('undone');
    expect(state.cur.months['2026-10']).toEqual(before.months['2026-10']);
    expect(() => applyProposal(applied, state.cur, dispatcher(state))).toThrow();
  });
  it('config change undo restores the plan', () => {
    const state = { cur: base() };
    const before = state.cur.config;
    const p = makeProposal('t4', 'update_item_rule', { itemId: 'petrol', rule: { type: 'fixed', rm: 250 } }, state.cur, TODAY);
    const a = applyProposal(p, state.cur, dispatcher(state));
    expect(state.cur.config).not.toEqual(before);
    undoProposal(a, dispatcher(state));
    expect(state.cur.config).toEqual(before);
  });
});

describe('cost maths', () => {
  it('prices sonnet 5.5 usage', () => {
    expect(usageCost({ input_tokens: 1_000_000 })).toBeCloseTo(2);
    expect(usageCost({ output_tokens: 1_000_000 })).toBeCloseTo(10);
    expect(usageCost({ cache_read_input_tokens: 1_000_000 })).toBeCloseTo(0.2);
    const u = { input_tokens: 600, cache_read_input_tokens: 17400, output_tokens: 620 };
    expect(usageCost(u)).toBeCloseTo(0.0012 + 0.00348 + 0.0062, 5);
    expect(costFooter(u)).toBe('~US$0.01 · 18k in / 620 out');
  });
});

function sse(events: unknown[]) {
  const text = events.map((e: any) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return new Response(new Blob([text]).stream());
}
const streamEvents = (blocks: any[], stop: string) => [
  { type: 'message_start', message: { usage: { input_tokens: 100, cache_read_input_tokens: 5000 } } },
  ...blocks.flatMap((b, i) => [
    { type: 'content_block_start', index: i, content_block: b.type === 'tool_use' ? { type: 'tool_use', id: b.id, name: b.name, input: {} } : b.type === 'thinking' ? { type: 'thinking', thinking: '' } : { type: 'text', text: '' } },
    b.type === 'tool_use' ? { type: 'content_block_delta', index: i, delta: { type: 'input_json_delta', partial_json: JSON.stringify(b.input) } }
      : b.type === 'thinking' ? { type: 'content_block_delta', index: i, delta: { type: 'thinking_delta', thinking: 'hmm' } }
      : { type: 'content_block_delta', index: i, delta: { type: 'text_delta', text: b.text } },
    ...(b.type === 'thinking' ? [{ type: 'content_block_delta', index: i, delta: { type: 'signature_delta', signature: 'sig' } }] : []),
    { type: 'content_block_stop', index: i },
  ]),
  { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 50 } },
  { type: 'message_stop' },
];

describe('anthropic client + tool loop (mock SSE)', () => {
  it('parses text, thinking and tool_use streams', async () => {
    const chunks: string[] = [];
    const r = await readStream(sse(streamEvents([{ type: 'thinking' }, { type: 'text', text: 'Hello' }, { type: 'tool_use', id: 'tu1', name: 'run_health', input: { monthId: '2026-10' } }], 'tool_use')).body!, (t) => chunks.push(t));
    expect(chunks.join('')).toBe('Hello');
    expect(r.stop_reason).toBe('tool_use');
    expect(r.content[0]).toMatchObject({ type: 'thinking', thinking: 'hmm', signature: 'sig' });
    expect(r.content[2]).toMatchObject({ type: 'tool_use', input: { monthId: '2026-10' } });
    expect(r.usage).toMatchObject({ input_tokens: 100, output_tokens: 50 });
  });
  it('sends the right headers/body and retries on 529', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response('{"error":{"message":"busy"}}', { status: 529 }))
      .mockResolvedValueOnce(sse(streamEvents([{ type: 'text', text: 'ok' }], 'end_turn')));
    vi.useFakeTimers();
    const p = makeTransport('KEY', f as any)({ model: 'claude-sonnet-5-5', max_tokens: 10, system: 's', messages: [{ role: 'user', content: 'hi' }], effort: 'medium' }, () => {});
    await vi.runAllTimersAsync();
    const r = await p;
    vi.useRealTimers();
    expect(r.content[0]).toMatchObject({ text: 'ok' });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers['x-api-key']).toBe('KEY');
    expect(init.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(JSON.parse(init.body)).toMatchObject({ stream: true, output_config: { effort: 'medium' } });
  });
  it('401 surfaces as an API error', async () => {
    const f = vi.fn().mockResolvedValue(new Response('{"error":{"message":"bad key"}}', { status: 401 }));
    await expect(makeTransport('K', f as any)({ model: 'm', max_tokens: 1, system: '', messages: [] }, () => {})).rejects.toMatchObject({ status: 401 });
  });

  it('runs read tools automatically, makes proposals from write tools, then answers', async () => {
    const script: StreamResult[] = [
      { content: [{ type: 'text', text: 'Checking.' }, { type: 'tool_use', id: 'a', name: 'run_health', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 10 } },
      { content: [{ type: 'tool_use', id: 'b', name: 'log_surprise', input: { date: TODAY, what: 'Car service', rm: 350, paidFrom: 'car-wear' } }, { type: 'tool_use', id: 'c', name: 'log_surprise', input: { date: TODAY, what: 'bad', rm: 1, paidFrom: 'zzz' } }], stop_reason: 'tool_use', usage: { output_tokens: 5 } },
      { content: [{ type: 'text', text: 'Proposed.' }], stop_reason: 'end_turn', usage: { output_tokens: 7 } },
    ];
    const seen: any[] = [];
    const transport: Transport = async (req) => { seen.push(req); return script.shift()!; };
    const d = base();
    const thread: Thread = { id: 't', title: 't', createdAt: '', messages: [{ role: 'user', content: 'go' }], proposals: {} };
    const { usage } = await runTurn({ transport, model: 'm', today: TODAY, getData: () => d, thread, events: { onText: () => {} } });
    expect(usage).toMatchObject({ input_tokens: 10, output_tokens: 12 });
    expect(thread.proposals['p-b'].status).toBe('pending');
    expect(thread.proposals['p-c']).toBeUndefined();
    // tool results: read result is data, write result says "proposed", invalid one is an error
    const results = (thread.messages[4].content as any[]);
    expect(results[0].content).toContain('proposed');
    expect(results[1].is_error).toBe(true);
    expect(seen[0].system[1].cache_control).toEqual({ type: 'ephemeral' });
    expect(systemBlocks(d, TODAY)[1].text).not.toMatch(/token|apiKey/i);
    expect(windowMessages(thread)[0].content).toBe('go');
  });
  it('windows long threads without starting on a tool_result', () => {
    const t: Thread = { id: 't', title: '', createdAt: '', proposals: {}, messages: [] };
    for (let i = 0; i < 40; i++) t.messages.push(i % 2 ? { role: 'assistant', content: 'a' } : { role: 'user', content: 'u' });
    const w = windowMessages(t);
    expect(w.length).toBeLessThanOrEqual(30);
    expect(w[0].role).toBe('user');
  });
});

import type { StreamRequest, StreamResult, Transport, Block } from './anthropic';
import { todayKL } from './context';

const usage = { input_tokens: 600, cache_read_input_tokens: 17400, output_tokens: 620 };
const last = (r: StreamRequest) => r.messages[r.messages.length - 1];
const lastUserText = (r: StreamRequest) => {
  for (let i = r.messages.length - 1; i >= 0; i--) {
    const m = r.messages[i];
    if (m.role === 'user' && typeof m.content === 'string') return m.content;
  }
  return '';
};

/** Canned conversation for ?demo=1 and tests: no network, dummy numbers only. */
export const demoTransport: Transport = async (req, onText) => {
  const isToolResult = Array.isArray(last(req).content) && (last(req).content as Block[]).some((b) => b.type === 'tool_result');
  const q = lastUserText(req).toLowerCase();
  const say = (text: string, extra: Block[] = [], stop = 'end_turn'): StreamResult => { onText(text); return { content: [{ type: 'text', text }, ...extra], stop_reason: stop, usage }; };

  if (!isToolResult && /(log|car service|350)/.test(q)) {
    return say('Let me check your car fund first.', [{ type: 'tool_use', id: 'toolu_demo2', name: 'log_surprise', input: { date: todayKL(), what: 'Car service', rm: 350, paidFrom: 'car-wear', emergency: false } }], 'tool_use');
  }
  if (!isToolResult && /(on track|how am i|this month)/.test(q)) {
    return say('Checking this month and your funds.', [{ type: 'tool_use', id: 'toolu_demo1', name: 'run_health', input: {} }], 'tool_use');
  }
  if (isToolResult) {
    const c = JSON.stringify(last(req).content);
    if (c.includes('proposed')) return say('I have prepared that as a proposal. **Tap Apply** to save it. The car fund will go below zero, so you may want to top it up from this month\'s surplus.');
    return say('**Mostly on track.**\n\n| Check | Status |\n|---|---|\n| Zero-based | green |\n| Savings rate | green |\n| Emergency fund | red (below 3 months) |\n\nThe emergency fund is the one to watch. Any big purchase coming up?');
  }
  return say('This is demo mode with canned answers. Try "Am I on track this month?" or "Log RM350 car service from car fund".');
};

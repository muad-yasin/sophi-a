// The messages-api seat adapter (PLAN.md "Seat invocation mechanism" > "messages-api seat"),
// used only by the `advisor` seat - a single stateless request/response call per intervention,
// not a plan-producing chain. Imports relay's own src/providers.js Anthropic adapter directly;
// does not spawn relay's CLI or invoke its MCP server (see PLAN.md "What 'reuses relay's backend'
// means, precisely").
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root } from '../index.js';

const TIMEOUT_MS = 300_000; // 300s, per PLAN.md's status/event model table

const ADVISOR_SYSTEM = 'You are Fable, an advisor watching the command-and-control seat\'s ' +
  'decisions in a multi-agent build harness. You are shown one decision or plan and asked for a ' +
  'short, direct intervention: what you would flag, confirm, or push back on. One to three ' +
  'sentences. No preamble.';

// Resolved lazily, not at module top-level - this module and src/orchestrator/index.js import
// each other, and `root` is a live ES-module binding only actually assigned by the time a seat
// is started (see relayChainSubprocess.js for the same pattern).
function resolveRelayPath() {
  return path.resolve(process.env.RELAY_PATH || path.join(root, '..', 'relay'));
}

// relay's own provider-call function reads API keys straight from process.env - it never loads
// relay's .env itself (only relay's cli.js entry point does that minimal parsing). Since this
// adapter calls that function in-process rather than through relay's CLI, it has to load
// relay's .env the same minimal way relay/src/cli.js does, once, before the first real call.
let envLoaded = false;
function loadRelayEnv() {
  if (envLoaded) return;
  envLoaded = true;
  const envPath = path.join(resolveRelayPath(), '.env');
  if (!existsSync(envPath)) return;
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && m[2] && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

let providersModulePromise = null;
function loadProviders() {
  if (!providersModulePromise) {
    loadRelayEnv();
    const p = path.join(resolveRelayPath(), 'src', 'providers.js');
    providersModulePromise = import(`file://${p}`);
  }
  return providersModulePromise;
}

/**
 * Start one messages-api seat (advisor).
 * @param {string} seatId
 * @param {object} seatConfig - this seat's entry from seats.json (has `.model`)
 * @param {string} task - the plain-text prompt for this stateless call
 * @param {(type: string, detail?: any) => void} emit
 */
export async function startMessagesApiSeat(seatId, seatConfig, task, emit) {
  emit('seat.start');

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; }, TIMEOUT_MS);

  try {
    const { call } = await loadProviders();
    emit('seat.working');

    // relay's Anthropic adapter (src/providers.js callAnthropic) is a single non-streaming
    // POST that returns the complete reply, not a token stream - there is no real per-token
    // delta to slice into separate seat.working/seat.output pairs the way PLAN.md's mechanism
    // section describes for a truly streaming call. Documented here rather than faked: the
    // whole reply lands as one seat.output once the call resolves. A future slice could add
    // real Anthropic SSE streaming directly rather than routing through relay's non-streaming
    // helper, if per-token UI updates for the advisor pane turn out to matter.
    const result = await call('anthropic', {
      // seatConfig.model is a placeholder identifier (PLAN.md "Seat registry": "claude-fable-5-1")
      // pending Anthropic's actual API identifier for Fable 5.1 at build time - passed through
      // as-is rather than silently substituted for a guessed real model string.
      model: seatConfig.model,
      system: ADVISOR_SYSTEM,
      messages: [{ role: 'user', content: task }],
      maxTokens: 1024,
    });

    clearTimeout(timer);
    if (timedOut) {
      emit('seat.problem', `advisor call timed out after ${TIMEOUT_MS / 1000}s`);
      return;
    }
    emit('seat.output', result.text);
    emit('seat.idle');
  } catch (err) {
    clearTimeout(timer);
    emit('seat.problem', err?.message || String(err));
  }
}

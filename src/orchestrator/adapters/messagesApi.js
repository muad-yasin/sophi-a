// The messages-api seat adapter (PLAN.md "Seat invocation mechanism" > "messages-api seat"),
// used by the `advisor` seat always, and by `cnc` whenever its `provider` isn't `anthropic`
// (PLAN.md's second 2026-09-09 addendum - a real chat seat on any allowed provider, honestly
// without claude-code-subprocess's tool-use/file-editing). Calls relay's own src/providers.js
// `call(provider, opts)` directly; does not spawn relay's CLI or invoke its MCP server (see
// PLAN.md "What 'reuses relay's backend' means, precisely").
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { root } from '../index.js';
import { isAllowedProvider } from '../providers.js';

const TIMEOUT_MS = 300_000; // 300s, per PLAN.md's status/event model table

const ADVISOR_SYSTEM = 'You are Fable, an advisor watching the command-and-control seat\'s ' +
  'decisions in a multi-agent build harness. You are shown one decision or plan and asked for a ' +
  'short, direct intervention: what you would flag, confirm, or push back on. One to three ' +
  'sentences. No preamble.';

// Used only when `cnc` falls back to this adapter (its provider isn't anthropic). Disclosed
// plainly to the model itself, not just the UI - it should not imply it can edit files or run
// tools, since in this mode it genuinely cannot.
const CNC_CHAT_SYSTEM = 'You are the command-and-control seat of a multi-agent build harness, ' +
  'talking directly with the human operator. You are running on a non-Anthropic model in ' +
  'chat-only mode: you have no tool use, no file editing, and no ability to run commands here - ' +
  'say so if asked to do any of that. Help with planning, oversight, and conversation instead.';

// Per-seat in-memory chat history (PLAN.md: `cnc`'s chat-fallback mode is one ongoing
// conversation, not a stateless call-per-turn like `advisor`). Cleared on orchestrator restart -
// no persistence, matching `claude-code-subprocess`'s own session_id lifetime.
const histories = new Map();

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

  const provider = seatConfig.provider || 'anthropic';
  if (!isAllowedProvider(provider)) {
    emit('seat.problem', `provider "${provider}" is not in cnc-harness's allowed-provider list`);
    return;
  }

  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; }, TIMEOUT_MS);

  try {
    const { call } = await loadProviders();
    emit('seat.working');

    const isAdvisor = seatId === 'advisor';
    const system = isAdvisor ? ADVISOR_SYSTEM : CNC_CHAT_SYSTEM;
    const history = seatConfig.chat_history ? (histories.get(seatId) || []) : [];
    const messages = [...history, { role: 'user', content: task }];

    // relay's provider adapters (src/providers.js) are single non-streaming POSTs that return
    // the complete reply, not a token stream - there is no real per-token delta to slice into
    // separate seat.working/seat.output pairs the way PLAN.md's mechanism section describes for
    // a truly streaming call. Documented here rather than faked: the whole reply lands as one
    // seat.output once the call resolves. A future slice could add real streaming directly per
    // provider if per-token UI updates turn out to matter.
    const result = await call(provider, {
      // seatConfig.model is a placeholder identifier for Anthropic seats (PLAN.md "Seat
      // registry": "claude-fable-5-1"); for other providers it's whatever model id that
      // provider expects - passed through as-is, never silently substituted.
      model: seatConfig.model,
      system,
      messages,
      maxTokens: 1024,
    });

    clearTimeout(timer);
    if (timedOut) {
      emit('seat.problem', `${seatId} call timed out after ${TIMEOUT_MS / 1000}s`);
      return;
    }
    if (seatConfig.chat_history) {
      histories.set(seatId, [...messages, { role: 'assistant', content: result.text }]);
    }
    emit('seat.output', result.text);
    emit('seat.idle');
  } catch (err) {
    clearTimeout(timer);
    emit('seat.problem', err?.message || String(err));
  }
}

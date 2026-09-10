// Phase 1 Step 1 of the long-horizon build plan
// (relay run 2026-09-10T20-03-03-692Z/revise-1.md, Council-approved unanimous round 2).
// Checks whether every seat is actually ready to run, before the wizard UI (Step 2) gates its
// Send button on the result. Two requirement kinds, per seats.json's own `requires` field
// (`[{type: 'binary'|'env', name}]`), checked independently and never conflated:
//
//   - 'binary': is the named executable on PATH (`claude`, for claude-code-subprocess seats).
//     A missing binary is always `type: 'missing_cli'`.
//   - 'env': is the named provider env var actually a *working* key, checked with a real,
//     minimal messages-API call (not just "is the var set") on the operator's own key, 2s
//     timeout. A DNS/timeout failure is always `type: 'network'`; a real 401/403-shaped
//     rejection is always `type: 'auth'` - conflating the two would tell someone with no
//     internet connection that their key is wrong, the more consequential wrong answer.
//
// Deliberate scope limit, not an oversight: a relay-chain-subprocess seat (plan-1..3) runs a
// real multi-provider chain (plan-cheap.json uses 6 providers total), but this step only checks
// the one provider that seat's own `requires` names (anthropic - the seat that drafts/revises,
// and the one whose failure aborts a run immediately). Checking every critic provider a chain
// might reach is real added scope this step's acceptance test doesn't ask for.
import { execFile } from 'node:child_process';
import { loadProviders } from './adapters/messagesApi.js';
import { ALLOWED_PROVIDERS } from './providers.js';

const PING_TIMEOUT_MS = 2000;

// Known-cheap, known-good model id per provider - the same ids relay's own plan-cheap.json
// critic seats already use in production (relay/chains/plan-cheap.json), not guessed; anthropic
// matches seats.json's own model id for cnc/build seats.
const PING_MODEL = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5-mini',
  google: 'gemini-3.6-flash',
  mistral: 'mistral-small-latest',
  deepseek: 'deepseek-chat',
  groq: 'llama-3.3-70b-versatile',
  cohere: 'command-r7b-12-2024',
  openrouter: 'meta-llama/llama-3.3-70b-instruct',
  together: 'Qwen/Qwen3.5-9B',
  zai: 'glm-4.7-flash',
};

function providerForEnvVar(envVar) {
  return ALLOWED_PROVIDERS.find(p => p.envVar === envVar)?.id;
}

function checkBinary(name) {
  return new Promise((resolve) => {
    execFile(name, ['--version'], { timeout: PING_TIMEOUT_MS }, (err) => {
      if (err) {
        resolve({ status: 'error', error: { type: 'missing_cli', detail: err.message } });
      } else {
        resolve({ status: 'ready' });
      }
    });
  });
}

async function checkEnv(envVar) {
  // loadProviders() is what actually populates process.env from relay's own .env
  // (messagesApi.js's loadRelayEnv(), called internally) - a key set only there, never in this
  // process's own environment, would otherwise read as "not set" even though it's real. Call
  // this first (it's cached/idempotent) so the presence check below sees the real picture.
  const { call } = await loadProviders();
  const key = process.env[envVar];
  if (!key) {
    return { status: 'error', error: { type: 'auth', detail: `${envVar} is not set` } };
  }
  const provider = providerForEnvVar(envVar);
  const model = PING_MODEL[provider];
  try {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error('ping timed out'), { isTimeout: true })), PING_TIMEOUT_MS);
    });
    try {
      await Promise.race([
        call(provider, {
          model,
          system: 'Reply with one word.',
          messages: [{ role: 'user', content: 'ping' }],
          maxTokens: 8,
        }),
        timeout,
      ]);
    } finally {
      clearTimeout(timer);
    }
    return { status: 'ready' };
  } catch (err) {
    if (err?.isTimeout) {
      return { status: 'error', error: { type: 'network', detail: 'no reply within 2s' } };
    }
    // Never guess in the auth direction - a network-shaped error that also happens to contain
    // an ambiguous word must resolve to 'network', the less consequential wrong answer.
    const msg = String(err?.message || err);
    const looksLikeNetwork = /ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|fetch failed|network error/i.test(msg);
    const looksLikeAuth = /\b401\b|\b403\b|unauthorized|invalid api key|authentication/i.test(msg);
    if (looksLikeAuth && !looksLikeNetwork) {
      return { status: 'error', error: { type: 'auth', detail: msg } };
    }
    return { status: 'error', error: { type: 'network', detail: msg } };
  }
}

/**
 * Check readiness for one seat, per its seats.json `requires` list. Checks in order and
 * returns on the first failure - a seat needing both a binary and a key only reports the first
 * thing actually missing, not every problem at once (matches the wizard's one-line-per-seat
 * display, Phase 1 Step 2).
 * @param {string} seatId
 * @param {{requires?: {type: 'binary'|'env', name: string}[]}} seat - seats.json entry
 * @returns {Promise<{seat: string, status: 'ready'|'error', error?: {type: string, detail: string}}>}
 */
export async function checkSeatReadiness(seatId, seat) {
  for (const req of seat.requires || []) {
    const result = req.type === 'binary' ? await checkBinary(req.name) : await checkEnv(req.name);
    if (result.status === 'error') {
      return { seat: seatId, status: 'error', error: result.error };
    }
  }
  return { seat: seatId, status: 'ready' };
}

/** Check every seat in seats.json. Returns one result per seat, in seats.json's own order. */
export async function checkAllSeats(seats) {
  const results = [];
  for (const [seatId, seat] of Object.entries(seats)) {
    results.push(await checkSeatReadiness(seatId, seat));
  }
  return results;
}

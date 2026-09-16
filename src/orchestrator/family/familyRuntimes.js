// Sophi-A seat-owned families, F5 (relay/Docs/SophiA-Seat-Families-Plan.md §2.7; council review
// relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §b "No-write invariant for chat/council
// runtimes" and §d item 4). `dispatchTurn(family, session, task, emit)` routes by
// `session.runtime`. Write capability is a property of the runtime, not of the family (§2.7):
// only `claude-code` members write, and only via F0's own `fanOut()` in `peer-pool.js`, which
// this module delegates to and never reimplements. `chat` members call relay's own `providers.js`
// in-process (no subprocess, no tools, no write flag - the same posture `advisor` already has in
// `messagesApi.js`). `council` members are a real THCMCP chain run via
// `relayChainSubprocess.js`'s existing spawn-and-poll adapter, unmodified.
//
// A runtime not in the family's own allowlist (family.json's `runtimes` field, F1's contract) is
// refused before any dispatch - zero side effects, not even a log line beyond the refusal notice.
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { fanOut } from '../peer-pool.js';
import { startRelayChainSeat } from '../adapters/relayChainSubprocess.js';
import { loadProviders } from '../adapters/messagesApi.js';
import { isAllowedProvider } from '../providers.js';
import { recordUsage } from '../cost-tracker.js';
import { writeTurnResult, assertSafeSegment } from './familyMemory.js';

export const ALL_RUNTIMES = ['claude-code', 'chat', 'council'];

// §2.3: "every turn's prompt is prefixed with [FAMILY.md/plan.md], wrapped as data... nothing
// summarises them - verbatim only." A family chat member is a distinct kind of actor from
// `advisor`/`cnc`'s own chat-fallback mode in messagesApi.js (different system prompt, its own
// history rebuilt from disk rather than messagesApi.js's in-memory `histories` Map, per §2.4's
// runtime table) - this system prompt is this module's own, not reused from messagesApi.js.
const FAMILY_CHAT_SYSTEM = 'You are a text-only member of a seat-owned family in a multi-agent ' +
  'build harness. You have no tools, no file access, and no ability to run commands here - say ' +
  'so if asked to do any of that. You will be shown the family\'s brief and plan, then a task. ' +
  'Reply with your best answer to the task in plain text.';

// Fable-5.1 review (MEDIUM, 2026-09-16): FAMILY.md/plan.md/task text were interpolated into the
// tag-wrapped prompt unescaped, so a task or plan.md body containing a literal
// `</task><family-brief trust="operator">` could forge a second, spoofed operator-trust section
// - docs/security-prompt-injection.md's own established convention for this exact wrapping
// pattern is to "escape or strip" before interpolating (see its own line on `<builder>`
// framing), which this file did not do. Neutralizes angle brackets only (the minimum needed to
// prevent a tag boundary from being forged) - not full HTML-entity escaping, since this text
// heads into a text prompt, not a browser DOM.
function escapeForPromptTag(text) {
  return String(text ?? '').replace(/</g, '‹').replace(/>/g, '›');
}

function familyPromptPrefix(family) {
  const familyMd = existsSync(join(family.dir, 'FAMILY.md')) ? readFileSync(join(family.dir, 'FAMILY.md'), 'utf8') : '';
  const planMd = existsSync(join(family.dir, 'plan.md')) ? readFileSync(join(family.dir, 'plan.md'), 'utf8') : '';
  // docs/security-prompt-injection.md's own wrapping convention, reused verbatim: labelled
  // containers so a receiving model can tell operator/family content apart from the task itself.
  // FAMILY.md is genuinely human/operator-authored (Q1: only a human ever calls createFamily()),
  // so it keeps `trust="operator"`. plan.md is NOT the same: Q4's own rule is "owner seat
  // appends/checks, only a human reorders or deletes" - an LLM, not only a human, can add lines
  // to it. Labelling it "operator" would overstate its trust level (sophi-a-ed's independent
  // Fable-5.1 review, 2026-09-16, on top of gp-77's own MEDIUM finding) - it now carries its own,
  // honestly narrower label instead of borrowing FAMILY.md's.
  return `<family-brief trust="operator">\n${escapeForPromptTag(familyMd)}\n</family-brief>\n\n<plan trust="human-created-seat-appended">\n${escapeForPromptTag(planMd)}\n</plan>`;
}

// Fable-5.1 security review (HIGH, 2026-09-16): this module built session-directory paths from a
// raw sessionId and wrote files under them BEFORE familyMemory.writeTurnResult() ever ran its own
// assertSafeSegment() check - a sessionId like "../../../home/user/.claude" would have escaped
// .families/ entirely and had attacker-influenced task text written there, with the validating
// throw only arriving after that write already happened. Every function below that turns a
// sessionId/turn into a path now validates first - reusing familyMemory.js's own exported check,
// never a second copy of the same regex.
function turnFilesDir(family, sessionId) {
  assertSafeSegment('sessionId', sessionId);
  return join(family.dir, 'sessions', sessionId, 'turns');
}

function paddedTurn(turn) {
  if (!Number.isInteger(turn) || turn < 1) {
    throw new Error(`familyRuntimes: turn must be a positive integer, got ${JSON.stringify(turn)}`);
  }
  return String(turn).padStart(4, '0');
}

// Rebuilds a chat member's history from its own turns/*.task.md + *.out.md pairs on disk - never
// from messagesApi.js's in-memory `histories` Map, which is per-seat and does not exist for a
// family session (§2.4's own runtime table: "history rebuilt from disk, not from `histories`
// Map"). Reads only THIS session's own turns - a family's context/ hand-off mechanism is a
// separate, explicit thing (see contextFileIsGated below), not folded silently into history.
function rebuildChatHistory(family, sessionId) {
  const dir = turnFilesDir(family, sessionId);
  if (!existsSync(dir)) return [];
  const taskFiles = readdirSync(dir).filter(f => f.endsWith('.task.md')).sort();
  const history = [];
  for (const taskFile of taskFiles) {
    const n = taskFile.slice(0, taskFile.indexOf('.'));
    const outFile = `${n}.out.md`;
    const taskText = readFileSync(join(dir, taskFile), 'utf8');
    history.push({ role: 'user', content: taskText });
    if (existsSync(join(dir, outFile))) {
      history.push({ role: 'assistant', content: readFileSync(join(dir, outFile), 'utf8') });
    }
  }
  return history;
}

/**
 * §2.7, new bullet (deliverable §d item 4): a `context/` file that did not originate from its
 * own session's turns must carry a passing `NNNN.gate.json` before a `claude-code` member's next
 * dispatch includes it - an ungated file blocks that dispatch outright, not a warning. This
 * function is the check itself; the caller (F7, a different session's composition point) is
 * responsible for actually invoking it before building a claude-code member's prompt. Exposed
 * here (not a private helper) because F5's own dispatch of chat/council members is exactly what
 * can *produce* the ungated artifact this check exists to catch before it reaches a write-capable
 * member.
 *
 * Fable-5.1 review (MEDIUM, 2026-09-16, both independent reviews - gp-77's and sophi-a-ed's):
 * a `.gate.json` carrying only `{result}` is unbound to the content it claims to have reviewed -
 * any write-capable member could forge a passing record, or content edited after gating would
 * still read as gated. Fixed by binding the gate record to a `sha256` field the checker verifies
 * against the real file's current content - a gate record that doesn't match (or doesn't carry
 * one at all) is blocked, same as a missing record. **This changes checkContextGate()'s own
 * expected `.gate.json` shape to `{result: "pass", sha256: "<hex>"}` - flagged explicitly to
 * Session D (F6/F9, the gate's actual writer) so their writer emits a matching field, rather
 * than silently assuming a shape their code doesn't produce yet.**
 * @param {{dir: string}} family
 * @param {string} sessionId
 * @returns {{ok: true} | {ok: false, blockedFiles: string[]}}
 */
export function checkContextGate(family, sessionId) {
  assertSafeSegment('sessionId', sessionId);
  const contextDir = join(family.dir, 'sessions', sessionId, 'context');
  if (!existsSync(contextDir)) return { ok: true };
  const blockedFiles = [];
  for (const entry of readdirSync(contextDir)) {
    if (entry.endsWith('.gate.json')) continue; // the gate record itself, not a content file
    // Fable-5.1 review (LOW, 2026-09-16), named rather than silently assumed: readdirSync is
    // non-recursive, so a nested subdirectory under context/ is treated exactly like any other
    // entry here - it gets checked for a sibling "<name>.gate.json" (which won't exist for a
    // directory), so it already falls into the missing-gate branch below and is blocked, not
    // silently skipped. Real files inside such a subdirectory are never individually examined,
    // though - a recursive walk was not added here since F7's dispatch wiring (a different
    // session) is what actually decides whether nested context/ content is a real shape this
    // build needs to support at all.
    const gatePath = join(contextDir, `${entry}.gate.json`);
    if (!existsSync(gatePath)) {
      blockedFiles.push(entry);
      continue;
    }
    let gate;
    try {
      gate = JSON.parse(readFileSync(gatePath, 'utf8'));
    } catch {
      blockedFiles.push(entry); // unreadable gate record - fail closed, never treat as passing
      continue;
    }
    // Fable-5.1 review (LOW, 2026-09-16): JSON.parse('null') succeeds and returns the literal
    // `null`, which would have thrown on `gate.result` below (a fail-closed exception, but a
    // violation of this function's own documented never-throw contract) rather than the
    // ok:false return every other malformed-input case already produces.
    if (gate === null || typeof gate !== 'object' || gate.result !== 'pass') {
      blockedFiles.push(entry);
      continue;
    }
    // Content binding (MEDIUM fix above): the gate record must name the exact content it
    // reviewed, and that content must still match right now.
    if (typeof gate.sha256 !== 'string' || gate.sha256.length === 0) {
      blockedFiles.push(entry);
      continue;
    }
    const actualHash = createHash('sha256').update(readFileSync(join(contextDir, entry))).digest('hex');
    if (actualHash !== gate.sha256) {
      blockedFiles.push(entry); // gated content has changed since - a stale gate is not a pass
    }
  }
  return blockedFiles.length ? { ok: false, blockedFiles } : { ok: true };
}

async function dispatchChatTurn(family, session, task, turn, emit) {
  emit('family.session.start', { sessionId: session.sessionId });
  const provider = session.provider || 'mock';
  if (!isAllowedProvider(provider) && provider !== 'mock') {
    emit('family.session.problem', { sessionId: session.sessionId, detail: `provider "${provider}" is not allowed` });
    return { dispatched: false, reason: 'provider-not-allowed' };
  }

  const history = rebuildChatHistory(family, session.sessionId);
  // escapeForPromptTag applies only to what's sent to the model - the verbatim, unescaped task
  // text is still what's written to disk below (§2.3's "verbatim only" rule is about the
  // persisted record, not the prompt-construction boundary this escaping protects).
  const prefixedTask = `${familyPromptPrefix(family)}\n\n<task>\n${escapeForPromptTag(task)}\n</task>`;

  // Verbatim on disk BEFORE the call (§2.3's own checkpoint discipline extends here) - the task
  // text a turn actually saw is itself a receipt-adjacent fact worth keeping, independent of
  // whether the call below succeeds.
  const filesDir = turnFilesDir(family, session.sessionId);
  const n = paddedTurn(turn);
  writeTextFile(join(filesDir, `${n}.task.md`), task);

  const startedAt = Date.now();
  let outText = '';
  let isError = false;
  let usage = { reported: false };
  try {
    emit('family.session.working', { sessionId: session.sessionId });
    const { call } = await loadProviders();
    const result = await call(provider, {
      model: session.model,
      system: FAMILY_CHAT_SYSTEM,
      messages: [...history, { role: 'user', content: prefixedTask }],
      maxTokens: 1024,
    });
    outText = result.text ?? '';
    // Real pricing lookup, the same recordUsage() messagesApi.js already uses for `advisor` -
    // relay's own call() returns only raw {input, output} token counts (confirmed by reading
    // THCMCP's src/providers.js callMock/callAnthropic/callOpenAICompat directly), never a
    // dollar figure or a priced flag itself; recordUsage() is what turns that into §2.5's
    // honesty-invariant shape (reported/priced/usd), not a field this module invents.
    usage = recordUsage({
      provider: result.provider ?? provider,
      model: result.model ?? session.model,
      inputTokens: result.usage?.input,
      outputTokens: result.usage?.output,
    });
  } catch (err) {
    isError = true;
    // Fable-5.1 review (LOW, 2026-09-16): a provider SDK/HTTP error message can carry request
    // URLs or response-body fragments - not a secret by itself, but worth capping the same way
    // relayChainSubprocess.js's own quoteFailure() caps a critic's problem text, rather than
    // persisting/emitting an unbounded provider-controlled string verbatim.
    const raw = err?.message || String(err);
    outText = raw.length > 500 ? `${raw.slice(0, 500)}…` : raw;
  }
  const endedAt = Date.now();

  writeTextFile(join(filesDir, `${n}.out.md`), outText);
  emit(isError ? 'family.session.problem' : 'family.session.idle', { sessionId: session.sessionId, detail: outText });

  const record = writeTurnResult(family, session.sessionId, turn, {
    planItem: session.planItem ?? null,
    runtime: 'chat',
    provider,
    model: session.model ?? null,
    startedAt, endedAt,
    exitCode: isError ? 1 : 0,
    isError,
    errorText: isError ? outText : undefined,
    usage,
    artifactPath: null, // a chat member has no workdir - text only, per §2.7 Q3
    verify: null, // chat members never run a verify command - they never touch a workdir
    state: isError ? 'failed-owned' : 'idle',
  });

  return { dispatched: true, record };
}

async function dispatchCouncilTurn(family, session, task, turn, emit) {
  emit('family.session.start', { sessionId: session.sessionId });
  const filesDir = turnFilesDir(family, session.sessionId);
  const n = paddedTurn(turn);
  writeTextFile(join(filesDir, `${n}.task.md`), task);

  const startedAt = Date.now();
  // Fable-5.1 review (LOW, 2026-09-16): session.chain reaches THCMCP's own --chain resolution,
  // which joins it into a filesystem path (`chains/<name>.json`) - no shell is involved (argv
  // array, not a shell string), so this was never a command-injection path, but an unvalidated
  // "../../something" value could still have named an arbitrary JSON file as a chain config.
  // Reuses the same safe-segment check every other id in this build goes through.
  const chainName = session.chain || 'mock';
  assertSafeSegment('session.chain', chainName);
  const seatConfig = { default_chain: chainName };
  // pseudo-seatId: relayChainSubprocess.js's own recordRun()/task-file naming is keyed by a
  // "seatId" string - a family session id is not a real seats.json seat, but the same naming
  // scheme works unchanged (it's just a filesystem-safe label to that adapter).
  const pseudoSeatId = `family-${family.ownerSeat}-${family.familyId}-${session.sessionId}`;

  return await new Promise(resolvePromise => {
    let settled = false;
    startRelayChainSeat(pseudoSeatId, seatConfig, task, (type, detail) => {
      if (settled) return;
      if (type === 'seat.idle' || type === 'seat.problem') {
        settled = true;
        const endedAt = Date.now();
        const isError = type === 'seat.problem';
        const outText = typeof detail === 'string' ? detail : JSON.stringify(detail ?? null);
        writeTextFile(join(filesDir, `${n}.out.md`), outText);
        emit(isError ? 'family.session.problem' : 'family.session.idle', { sessionId: session.sessionId, detail: outText });
        const record = writeTurnResult(family, session.sessionId, turn, {
          planItem: session.planItem ?? null,
          runtime: 'council',
          provider: null,
          model: null,
          startedAt, endedAt,
          exitCode: isError ? 1 : 0,
          isError,
          errorText: isError ? outText : undefined,
          usage: { reported: false }, // relayChainSubprocess.js emits its own seat.usage separately; not correlated here to avoid double-counting a family-level total from two sources
          artifactPath: null,
          verify: null,
          state: isError ? 'failed-owned' : 'idle',
        });
        resolvePromise({ dispatched: true, record });
      } else {
        emit(type, detail); // forward progress events (seat.working/seat.output/debate.report/seat.usage) unwrapped
      }
    });
  });
}

function writeTextFile(filePath, text) {
  // Verbatim text turn artifacts (task.md/out.md) - not JSON, so familyMemory.js's own
  // atomic-JSON writer doesn't apply; a plain write is acceptable here because this data is
  // regenerable from the same dispatch that produces the paired result.json (unlike
  // result.json itself, which familyMemory.js treats as the one authoritative receipt and
  // writes atomically). Uses node:fs directly, not familyMemory.js's private helpers.
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, text, 'utf8');
}

/**
 * Route one turn dispatch by `session.runtime`. Refuses before any side effect if the runtime is
 * not in `family.runtimes` (family.json's own allowlist, F1's contract) or not one of the three
 * runtimes this build ever recognizes.
 * @param {{dir: string, ownerSeat: string, familyId: string, runtimes?: string[]}} family
 * @param {{sessionId: string, runtime: string, provider?: string, model?: string, planItem?: string|null, handle?: string|null, chain?: string}} session
 * @param {string} task
 * @param {number} turn
 * @param {(type: string, detail?: any) => void} emit
 */
function familyRuntimesAllowlist(family) {
  // Real bug caught before this was reported done: createFamily()'s own return value is
  // `{dir, ownerSeat, familyId}` - it does not carry `runtimes` back to the caller, even though
  // it wrote that field into family.json. A caller that only has that bare descriptor (as
  // createFamily()'s own return, or a hand-built {dir, ownerSeat, familyId} object) would
  // silently fall through to the permissive ALL_RUNTIMES default here instead of the family's
  // real, configured allowlist. Fixed by reading family.json directly when `family.runtimes`
  // isn't already provided - the file is truth (§2.3), so this fallback read is honest, not a
  // second source of truth.
  if (Array.isArray(family.runtimes)) return family.runtimes;
  if (Array.isArray(family.familyJson?.runtimes)) return family.familyJson.runtimes;
  const familyJsonPath = join(family.dir, 'family.json');
  if (existsSync(familyJsonPath)) {
    try {
      const parsed = JSON.parse(readFileSync(familyJsonPath, 'utf8'));
      if (Array.isArray(parsed.runtimes)) return parsed.runtimes;
    } catch {
      // Fable-5.1 review (MEDIUM, 2026-09-16): a corrupt family.json previously fell through to
      // the permissive ALL_RUNTIMES default below - the opposite of "refused before any
      // dispatch." A family whose own allowlist can't be read is refused everything, not
      // granted everything; fail closed, matching familyMemory.js's own posture of degrading to
      // an explicit unreadable/error state rather than ever inferring permission from absence.
      return [];
    }
  }
  // No family.json at all, or a readable family.json with no (or non-array) `runtimes` field:
  // refuse every runtime rather than default to the most permissive list - same fail-closed
  // reasoning as the corrupt-file branch above, not just its exception path.
  return [];
}

export async function dispatchTurn(family, session, task, turn, emit) {
  // Fable-5.1 review (LOW, both independent reviews, 2026-09-16): a real family loaded via
  // createFamily()/loadFamilies() always has an already-validated ownerSeat/familyId (F1's own
  // entry-point checks), but dispatchTurn() itself accepted any hand-built {dir, ownerSeat,
  // familyId} without re-checking - only sessionId was validated downstream. Validated here,
  // once, at this function's own entry point, rather than trusting the caller.
  assertSafeSegment('ownerSeat', family.ownerSeat);
  assertSafeSegment('familyId', family.familyId);
  const allowlist = familyRuntimesAllowlist(family);
  if (!ALL_RUNTIMES.includes(session.runtime) || !allowlist.includes(session.runtime)) {
    emit('family.notice', {
      ownerSeat: family.ownerSeat, familyId: family.familyId, sessionId: session.sessionId,
      notice: `runtime "${session.runtime}" not in this family's allowlist (${allowlist.join(', ')}) - refused before dispatch`,
    });
    return { dispatched: false, reason: 'runtime-not-allowed' };
  }

  if (session.runtime === 'claude-code') {
    // §2.7: write capability lives only here, in F0's fanOut() - never reimplemented in this
    // module. Receipt-writing for a claude-code turn is a composition concern (F7, a different
    // session), not this router's - fanOut() itself writes nothing to familyMemory today.
    const { dispatched, notice } = fanOut(family.ownerSeat, {
      count: 1,
      task,
      sessionHandles: session.handle ? [session.handle] : [],
    }, emit);
    return { dispatched: dispatched.length > 0, notice, peerId: dispatched[0] ?? null };
  }
  if (session.runtime === 'chat') return dispatchChatTurn(family, session, task, turn, emit);
  return dispatchCouncilTurn(family, session, task, turn, emit);
}

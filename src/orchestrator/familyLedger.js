// Sophi-A seat-owned families, F3 (relay/Docs/SophiA-Seat-Families-Plan.md §2.5; council review
// relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §c "Session C - familyLedger.js (rewritten
// to derive from A's files)"). Rewrite of the MVP-polish version of this file: rows now derive
// from `familyMemory.js`'s `deriveLedgerView()` (F1's own file-walking function - this module
// does not re-walk the filesystem itself) rather than from peer-pool's in-memory events. Still
// read-only, still never a second source of truth - the two guards from the MVP version carry
// over unchanged in spirit: a source-grep proving this file never writes, and a before/after
// directory-hash test proving a render changes nothing on disk.
//
// No aggregate/comparative claim ever appears in this file's copy or its counts line -
// test/family-receipts.test.mjs greps both this module's source and its rendered/counted output
// against F3's extended forbidden-phrase list (widened from build.md's original set to also
// catch a raw percent sign and two named adjectives) - the exact list lives in the test file
// only, quoted nowhere in this comment, so this comment can't drift out of sync with it and
// can't ever self-match the very check it describes.
import { deriveLedgerView } from './family/familyMemory.js';

/**
 * One display row per turn receipt (`sessions/*\/turns/*.result.json`), derived straight from
 * `familyMemory.deriveLedgerView()` - never a second read of the filesystem.
 * @param {{dir?: string, ownerSeat?: string, familyId?: string}} family
 * @returns {{sessionId: string, turn: number, planItem: string|null, outcome: string, usage: string, timestamp: number|null, artifactPath: string|null}[]}
 */
export function familyReceiptRows(family) {
  return deriveLedgerView(family).map(toDisplayRow);
}

function usageText(usage) {
  // §2.5's own honesty invariant, verbatim: "reported:false renders 'usage not reported'; an
  // unpriced (Ollama) turn renders '~N tokens', never '$0'."
  if (!usage || usage.reported === false) return 'usage not reported';
  if (usage.priced === false) {
    const n = (usage.inputTokens || 0) + (usage.outputTokens || 0);
    return `~${n} tokens`;
  }
  return `$${(usage.usd || 0).toFixed(2)}`;
}

// relayChainSubprocess.js's own quoteFailure() pattern, reused: cap length and frame as quoted
// third-party text, so an upstream error string (which this ledger never authored and cannot
// vet) reads as quoted external content rather than this product's own prose - the same reason
// that pattern exists there. Fable-5.1 review (LOW, sophi-a-ed's independent review, 2026-09-16):
// familyLedger.js rendered errorText/verify.command verbatim and uncapped, so an upstream error
// string that happened to coincidentally match one of the forbidden-phrase-test's own banned
// substrings would render unguarded - capping and quoting doesn't make that impossible, but it
// does make the rendered text legible as a third party's words, not this system's own claim.
const DETAIL_PREVIEW_CHARS = 240;
function quoteDetail(text) {
  const truncated = text.length > DETAIL_PREVIEW_CHARS ? `${text.slice(0, DETAIL_PREVIEW_CHARS)}…` : text;
  return `"${truncated}"`;
}

function outcomeText(row) {
  const failed = row.isError === true || (typeof row.exitCode === 'number' && row.exitCode !== 0);
  if (failed) {
    // 'failure owned' language deliberately matches compassionCopy.js's FAILED-OWNED state -
    // the same real near-miss this whole build generalizes: a failure is shown verbatim, never
    // silently retried or summarized away.
    const detail = typeof row.errorText === 'string' ? row.errorText : (typeof row.result === 'string' ? row.result : `exit code ${row.exitCode}`);
    return `failure owned: ${quoteDetail(detail)}`;
  }
  // §2.5: "verify.command is operator-named, fixed per family or per task, never model-
  // generated... Absent -> verify: null, rendered 'not verified', never 'passed'."
  if (row.verify && typeof row.verify.command === 'string') {
    if (typeof row.verify.exitCode === 'number' && row.verify.exitCode !== 0) {
      return `failure owned: verify failed (${row.verify.command})`;
    }
    return `verified by ${row.verify.command}`;
  }
  return 'not verified';
}

function toDisplayRow(r) {
  return {
    sessionId: r.sessionId,
    turn: r.turn,
    planItem: r.planItem ?? null,
    outcome: outcomeText(r),
    usage: usageText(r.usage),
    timestamp: r.endedAt ?? r.startedAt ?? null,
    artifactPath: r.artifactPath ?? null,
    priced: r.usage?.priced !== false && r.usage?.reported !== false,
  };
}

/**
 * The counts line §2.5 describes ("7 turns, 5 verified by npm test, 2 failures owned, ~$0.41"),
 * plus the exact reproduction command a human can run themselves over the same directory - every
 * count here must be reproducible by that command, not just asserted by this function.
 * @param {{dir: string, ownerSeat: string, familyId: string}} family
 * @returns {{turns: number, verifiedCount: number, failedCount: number, notVerifiedCount: number, totalUsd: number|null, hasUnpricedSpend: boolean, text: string, reproCommand: string}}
 */
export function familyReceiptCounts(family) {
  const rows = familyReceiptRows(family);
  const turns = rows.length;
  const verifiedCount = rows.filter(r => r.outcome.startsWith('verified by ')).length;
  const failedCount = rows.filter(r => r.outcome.startsWith('failure owned:')).length;
  const notVerifiedCount = rows.filter(r => r.outcome === 'not verified').length;
  const hasUnpricedSpend = rows.some(r => !r.priced);
  const totalUsd = hasUnpricedSpend
    ? null
    : rows.reduce((sum, r) => sum + (r.usage.startsWith('$') ? Number(r.usage.slice(1)) : 0), 0);

  const usdPart = hasUnpricedSpend ? 'usage not reported for at least one turn' : `~$${totalUsd.toFixed(2)}`;
  const text = `${turns} turn${turns === 1 ? '' : 's'}, ${verifiedCount} verified, ${failedCount} failure${failedCount === 1 ? '' : 's'} owned, ${usdPart}`;

  return {
    turns, verifiedCount, failedCount, notVerifiedCount, hasUnpricedSpend,
    totalUsd,
    text,
    reproCommand: `find "${family.dir}/sessions" -name '*.result.json' | wc -l`,
  };
}

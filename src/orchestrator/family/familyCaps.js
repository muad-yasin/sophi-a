// Sophi-A seat-owned families, F4 (relay/Docs/SophiA-Seat-Families-Plan.md §2.8, tightened by
// relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §d item 5). Pure `admit()`: one enforcement
// point, three levels (family, seat, global), reusing `peer-pool.js`'s already-pure and already-
// tested `peersWithinSpendCeiling()` for the dollar arithmetic rather than re-deriving it. No
// I/O, no clock, no process state - every number this function reads is supplied by the caller.
import { peersWithinSpendCeiling } from '../peer-pool.js';

/**
 * @typedef {Object} CapLevel
 * @property {number} maxConcurrentSessions
 * @property {number} spendCeilingUsd
 * @property {number} activeCount - sessions currently running at this level, before this request
 */

/**
 * How many of `requested` fit under one level's concurrency cap alone.
 * @param {CapLevel} level
 * @param {number} requested
 */
function concurrencyFit(level, requested) {
  const availableSlots = Math.max(0, level.maxConcurrentSessions - level.activeCount);
  return Math.min(requested, availableSlots);
}

const LEVEL_NAMES = ['family', 'seat', 'global'];
const LEVEL_LABELS = { family: 'Family cap reached', seat: 'Seat cap reached', global: 'Global cap reached' };

/**
 * @param {Object} params
 * @param {number} params.requested - how many new sessions/turns are being requested
 * @param {CapLevel} params.family
 * @param {CapLevel} params.seat
 * @param {CapLevel} params.global
 * @param {{family: number, seat: number, global: number}} params.spends - real, already-spent
 *   USD (priced turns only) already accrued at each level, INCLUDING sessions in `needs-human` or
 *   any other terminal-looking state - a session's past spend is never excluded from these totals
 *   just because it isn't currently running (§2.8: "a stopped or needs-human session still counts
 *   its past spend"). This function trusts the numbers it's given; it is the caller's job (not
 *   this pure function's) to have summed them that way in the first place.
 * @param {{perTurnUsd: number, hasUnpricedSpend: boolean}} params.estimates - `perTurnUsd` is a
 *   real, caller-supplied worst-case estimate (0 if none available, same honesty stance
 *   `fanOut()`'s own `estimatedUsdPerPeer` already takes). `hasUnpricedSpend` is whether THIS
 *   family has ever recorded a `priced:false` turn - once true it stays true for the family's
 *   lifetime (the caller persists that flag; this function only reads it, once, per call).
 * @returns {{count: number, level: 'family'|'seat'|'global'|null, notice: string|null}}
 */
export function admit({ requested, family, seat, global, spends, estimates }) {
  const levels = { family, seat, global };
  const concurrencyCounts = {
    family: concurrencyFit(family, requested),
    seat: concurrencyFit(seat, requested),
    global: concurrencyFit(global, requested),
  };

  const hasUnpricedSpend = estimates?.hasUnpricedSpend === true;

  // §2.8, tightened: once any turn in the family's history is unpriced, the $-headroom branch
  // is never computed - not for this call, not for any later call while the flag stays true,
  // regardless of any priced turns that happened since. Admission falls through to the
  // concurrency minimum only. This degrades safely by construction: it never computes a false
  // headroom figure, it only ever refuses to claim one.
  if (hasUnpricedSpend) {
    const count = Math.min(concurrencyCounts.family, concurrencyCounts.seat, concurrencyCounts.global);
    const bindingLevel = count < requested ? bindingLevelName(concurrencyCounts, count) : null;
    return {
      count,
      level: bindingLevel,
      notice: 'unpriced spend present; $ headroom unavailable',
    };
  }

  const perTurnUsd = estimates?.perTurnUsd ?? 0;
  const dollarCounts = {
    family: peersWithinSpendCeiling(spends.family, requested, family.spendCeilingUsd, perTurnUsd),
    seat: peersWithinSpendCeiling(spends.seat, requested, seat.spendCeilingUsd, perTurnUsd),
    global: peersWithinSpendCeiling(spends.global, requested, global.spendCeilingUsd, perTurnUsd),
  };

  // Concurrency and dollars are independent constraints; the admitted count is the minimum
  // across both kinds, at every level - the same "dispatch fewer and say so" posture fanOut()
  // already takes for its own two independent caps.
  const perLevelCount = {
    family: Math.min(concurrencyCounts.family, dollarCounts.family),
    seat: Math.min(concurrencyCounts.seat, dollarCounts.seat),
    global: Math.min(concurrencyCounts.global, dollarCounts.global),
  };
  const count = Math.min(perLevelCount.family, perLevelCount.seat, perLevelCount.global);

  if (count >= requested) {
    return { count: requested, level: null, notice: null };
  }

  const level = bindingLevelName(perLevelCount, count);
  return {
    count,
    level,
    notice: `${LEVEL_LABELS[level]}, dispatching ${count} of ${requested}`,
  };
}

// "The first level that admits fewer wins" - family, then seat, then global, in that order: the
// first level whose own count equals the overall admitted minimum is reported as binding (ties
// broken in family-first order, matching the plan's own stated precedence).
function bindingLevelName(perLevelCount, overallCount) {
  for (const name of LEVEL_NAMES) {
    if (perLevelCount[name] === overallCount) return name;
  }
  return null;
}

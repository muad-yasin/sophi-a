// Seat cost meter, real numbers only (Phase 2 Step 2 of the long-horizon plan, revise-1.md;
// accepted proposal QWEN-6, GLM-2's "real numbers only, never 0" invariant folded in as the
// binding rule). One normalization layer all three adapters' usage hooks feed into, so the
// invariant is enforced in exactly one place rather than re-implemented per adapter.
//
// Ground truth (Phase 0's verify-assumptions.js, DECISIONS.md): a relay `report.json` has NO
// top-level `usage` field - usage lives at `report.totals` (aggregated) and
// `report.stages[].usage` (per stage). relayChainSubprocess.js's usage hook reads from there,
// never a flat `report.usage` that does not exist.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

let pricingCache = null;
function loadPricing() {
  if (!pricingCache) pricingCache = JSON.parse(readFileSync(join(here, 'pricing.json'), 'utf8'));
  return pricingCache;
}

// Same key shape as relay/src/pricing.json ("<provider>/<model>", verbatim - a model id may
// itself contain slashes, e.g. "together/meta-llama/Llama-3.3-70B-Instruct-Turbo"; this is a
// plain string key, not a split/parsed path, so that's never ambiguous).
function priceFor(provider, model) {
  if (!provider || !model) return null;
  return loadPricing()[`${provider}/${model}`] || null;
}

/**
 * Normalize one seat turn's real usage into the shape every adapter's `seat.usage` event and
 * the header ticker share. Never fabricates: a call this app genuinely has no token counts for
 * is `reported: false` (renders "usage not reported", never `0`); a call whose model has no
 * price on file (here or, for a relay-chain seat, in relay's own pricing.json) is
 * `priced: false` (renders `~N tokens`, never a guessed $ figure).
 *
 * @param {object} raw
 * @param {string} [raw.provider]
 * @param {string} [raw.model]
 * @param {number} [raw.inputTokens]
 * @param {number} [raw.outputTokens]
 * @param {number|null} [raw.usd] - pass a real dollar figure the caller already has (relay's own
 *   report.json totals, or the claude CLI's own `total_cost_usd`) to skip this module's own
 *   pricing.json lookup entirely - that lookup exists only for the messages-api path, which gets
 *   raw token counts with no cost attached.
 * @param {boolean} [raw.unpriced] - true if the caller already knows part of this usage has no
 *   price on file (e.g. relay's `report.totals.unpriced` was non-empty) - forces `priced: false`
 *   even though a `usd` figure is present, since that figure would only be a partial total.
 */
export function recordUsage({ provider, model, inputTokens, outputTokens, usd, unpriced } = {}) {
  const reported = typeof inputTokens === 'number' && typeof outputTokens === 'number';
  if (!reported) return { provider: provider ?? null, model: model ?? null, reported: false };

  let priced = false;
  let cost = null;
  if (unpriced) {
    // Caller already knows at least one real stage had no price on file - showing the partial
    // $ total as if it were the whole run's cost would be exactly the fabrication this module
    // exists to prevent.
    priced = false;
  } else if (typeof usd === 'number') {
    priced = true;
    cost = usd;
  } else {
    const price = priceFor(provider, model);
    if (price) {
      priced = true;
      cost = (inputTokens / 1_000_000) * price.in + (outputTokens / 1_000_000) * price.out;
    }
  }
  return { provider: provider ?? null, model: model ?? null, reported: true, inputTokens, outputTokens, priced, usd: priced ? cost : null };
}

/**
 * Fold one more normalized usage record into a seat's running session total. An unreported call
 * adds nothing measurable and never erases a prior real total; a run that mixes priced and
 * unpriced calls makes the whole running total honestly unpriced too (same reasoning as
 * `unpriced` above - a partial $ figure under one "total" label is a fabrication by omission).
 */
export function accumulate(previous, next) {
  const base = previous ?? { inputTokens: 0, outputTokens: 0, usd: 0, reported: false, priced: true };
  if (!next.reported) return base;
  return {
    inputTokens: base.inputTokens + next.inputTokens,
    outputTokens: base.outputTokens + next.outputTokens,
    usd: base.usd + (next.priced ? next.usd : 0),
    reported: true,
    priced: base.priced && next.priced,
  };
}

/**
 * Build a `recordUsage`-shaped entry straight from a relay `report.json` (Phase 0's corrected
 * ground truth: `report.totals` / `report.stages[].usage`, never `report.usage`).
 */
export function usageFromReport(report) {
  if (!report || !report.totals || typeof report.totals.input !== 'number') {
    return { provider: null, model: null, reported: false };
  }
  const unpriced = Array.isArray(report.totals.unpriced) && report.totals.unpriced.length > 0;
  return recordUsage({
    provider: 'relay',
    model: report.chain ?? null,
    inputTokens: report.totals.input,
    outputTokens: report.totals.output,
    usd: typeof report.totals.usd === 'number' ? report.totals.usd : null,
    unpriced,
  });
}

// Per-critic lines (this step's own acceptance note: "per-critic lines where report.json has
// them") - one entry per relay stage, for a future/optional per-stage UI line. Each stage is
// priced independently off relay's own per-stage usd/priced fields, never re-derived here.
export function stageUsageFromReport(report) {
  if (!Array.isArray(report?.stages)) return [];
  return report.stages.map(stage => ({
    label: stage.label ?? null,
    provider: stage.provider ?? null,
    model: stage.model ?? null,
    inputTokens: stage.usage?.input ?? null,
    outputTokens: stage.usage?.output ?? null,
    priced: stage.priced ?? false,
    usd: stage.priced ? (stage.usd ?? null) : null,
  }));
}

/** The formatting invariant itself, shared by anything that renders a usage total as text. */
export function formatUsage(totals) {
  if (!totals || !totals.reported) return 'usage not reported';
  const tokens = totals.inputTokens + totals.outputTokens;
  if (!totals.priced) return `~${tokens} tokens`;
  return `${tokens} tokens — $${totals.usd.toFixed(totals.usd < 0.01 && totals.usd > 0 ? 4 : 2)}`;
}

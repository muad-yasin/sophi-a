// Sophi-A Seat Families F0 (relay/runs/2026-09-15T19-57-10-287Z/deliverable.md §d.8,
// relay/Docs/SophiA-Seat-Families-Plan.md §2.2): loads and validates
// `../families.config.json` - one file, read once, never mutated at runtime (backend-developer
// rule 2: configuration is data, not code, with a built-in fallback for a missing file).
//
// Contract:
//   loadFamilyConfig(path?) -> { ok: true, config, source } | { ok: false, error }
//     Never throws. A missing file degrades to FLAG_OFF_CONFIG (§2.2: "A missing config file is
//     the same as flag-off"). A syntactically invalid file, or one naming an unsupported runtime
//     or provider, returns { ok: false, error } - the caller (peer-pool.js's fanOut()) is
//     responsible for folding that into the same flag-off fallback, never crashing.
//   seatFanOutAllowed(config, seatId) -> { allowed: boolean, reason: string|null }
//     Pure. With the top flag off, only 'cnc' is allowed (reason: null when allowed, the exact
//     legacy string otherwise - though peer-pool.js's own flag-off branch never actually calls
//     this; it is kept correct here too so the two paths cannot silently diverge). With the flag
//     on, a seat is allowed only if its own row exists and says enabled: true.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isAllowedProvider } from '../providers.js';

const here = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_CONFIG_PATH = join(here, '..', 'families.config.json');

// §9 Q3's answer (chat members stay text-only in v1) is enforced structurally elsewhere
// (familyRuntimes.js, F5 - not this module); this allowlist is the config-load-time half of
// regression risk (4)'s guard ("a non-Claude runtime given a write tool"): a runtime value
// outside this set is rejected before any family is ever created, not only at dispatch time.
export const VALID_RUNTIMES = ['claude-code', 'chat', 'council'];

// §2.2's own rule: "No xai anywhere, same standing exclusion as providers.js." - checked against
// the real ALLOWED_PROVIDERS list, not a second hand-kept copy of it.

export const FLAG_OFF_CONFIG = Object.freeze({
  schemaVersion: 1,
  enabled: false,
  global: Object.freeze({ maxConcurrentSessions: 4, spendCeilingUsd: 5.00 }),
  seats: Object.freeze({}),
});

const warnedSeats = new Set(); // "the loader clamps and logs once" (§2.2) - per seat, per process

/**
 * @param {string} [path] - defaults to the shipped families.config.json next to this module.
 * @returns {{ ok: true, config: object, source: string } | { ok: false, error: string }}
 */
export function loadFamilyConfig(path = DEFAULT_CONFIG_PATH) {
  if (!existsSync(path)) {
    return { ok: true, config: FLAG_OFF_CONFIG, source: 'default (no config file present)' };
  }

  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    return { ok: false, error: `families.config.json is not valid JSON: ${e.message}` };
  }

  const global = {
    maxConcurrentSessions: raw?.global?.maxConcurrentSessions ?? FLAG_OFF_CONFIG.global.maxConcurrentSessions,
    spendCeilingUsd: raw?.global?.spendCeilingUsd ?? FLAG_OFF_CONFIG.global.spendCeilingUsd,
  };

  const seats = {};
  for (const [seatId, row] of Object.entries(raw?.seats ?? {})) {
    for (const rt of row.runtimes ?? []) {
      if (!VALID_RUNTIMES.includes(rt)) {
        return { ok: false, error: `unsupported runtime ${rt}` };
      }
    }
    for (const p of row.providers ?? []) {
      if (!isAllowedProvider(p)) {
        return { ok: false, error: `unsupported provider ${p}` };
      }
    }

    const rawMaxConcurrent = row.maxConcurrentSessions ?? global.maxConcurrentSessions;
    const rawSpendCeiling = row.spendCeilingUsd ?? global.spendCeilingUsd;
    const maxConcurrentSessions = Math.min(rawMaxConcurrent, global.maxConcurrentSessions);
    const spendCeilingUsd = Math.min(rawSpendCeiling, global.spendCeilingUsd);

    if ((rawMaxConcurrent > global.maxConcurrentSessions || rawSpendCeiling > global.spendCeilingUsd)
      && !warnedSeats.has(seatId)) {
      warnedSeats.add(seatId);
      // eslint-disable-next-line no-console
      console.warn(`families.config.json: seat "${seatId}" cap(s) above global, clamped to global (${global.maxConcurrentSessions} sessions / $${global.spendCeilingUsd})`);
    }

    seats[seatId] = {
      enabled: row.enabled === true,
      maxConcurrentSessions,
      spendCeilingUsd,
      runtimes: Array.isArray(row.runtimes) ? row.runtimes : [],
      providers: Array.isArray(row.providers) ? row.providers : null,
    };
  }

  return {
    ok: true,
    config: { schemaVersion: raw.schemaVersion ?? 1, enabled: raw.enabled === true, global, seats },
    source: path,
  };
}

export function seatFanOutAllowed(config, seatId) {
  if (!config.enabled) {
    return { allowed: seatId === 'cnc', reason: seatId === 'cnc' ? null : 'Fan-out only allowed from cnc seat' };
  }
  const row = config.seats[seatId];
  if (!row || !row.enabled) {
    return { allowed: false, reason: `Fan-out not enabled for seat ${seatId} (families.seats.${seatId}.enabled is false)` };
  }
  return { allowed: true, reason: null };
}

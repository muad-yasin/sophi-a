// Rich status cards (2026-09-16): the one place a seat's progress subtitle, the DISPATCHED
// card's cap line and its per-seat chips are worded. Pure functions over the orchestrator's own
// `seat.progress` detail (src/orchestrator/run-log-progress.js for plan seats,
// adapters/claudeCodeSubprocess.js for build/cnc seats) - no DOM, no clock, so node can test the
// exact strings (test/seat-progress.test.mjs imports this file directly; keep the syntax to what
// node's type stripping accepts: no enums, no parameter properties, no namespaces).
//
// The rule every branch follows: a number is printed only when the orchestrator has actually
// reported it. A field that is still `null` is left out of the sentence, never rendered as 0 and
// never estimated - the same "honest non-failure state" the cost ticker already uses for
// "usage not reported".

export type SeatStatus = "idle" | "working" | "problem" | "timeout" | "attention";

export interface RelayProgress {
  kind: "relay";
  chain: string | null;
  maxRounds: number | null;
  capUsd: number | null;
  stage: string | null;
  round: number | null;
  proposalsExpected: number | null;
  proposalsIn: number | null;
  openObjections: number | null;
  capReached: boolean;
  done: boolean;
  waitingOn?: { external: string } | { signoff: number };
}

export interface CodeProgress {
  kind: "claude-code";
  filesTouched: number;
  toolCalls: number;
}

export type SeatProgress = RelayProgress | CodeProgress;

// One pinned-locale formatter for every figure this module prints (frontend-developer's data
// binding rule) - never the platform default, so "1 objection" is never "1,0 objection".
const count = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
// "$5" for a whole-dollar cap, "$0.50" otherwise - never "$0.5", never "$5.00" (the mockup's
// "$5 ceiling" reads as a cap, not a running total; cents only when they carry information).
const wholeMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 });
const centsMoney = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = { format: (usd: number) => (Number.isInteger(usd) ? wholeMoney : centsMoney).format(usd) };

function plural(n: number, one: string, many = `${one}s`): string {
  return `${count.format(n)} ${n === 1 ? one : many}`;
}

function objectionsPhrase(n: number | null): string | null {
  if (n === null) return null;
  return n === 0 ? "no objections open" : `${plural(n, "objection")} open`;
}

function relaySubtitle(status: SeatStatus, p: RelayProgress): string | null {
  if (status === "attention" && p.waitingOn) {
    if ("external" in p.waitingOn) return `Blocking question · ${p.waitingOn.external} seat`;
    return `No sign-off · ${plural(p.waitingOn.signoff, "objection")} open`;
  }
  if (status === "idle" && p.done) {
    return p.round === null ? "Signed off" : `Signed off · ${plural(p.round, "round")}`;
  }
  if (p.round !== null) {
    const head = p.maxRounds === null ? `Round ${count.format(p.round)}` : `Round ${count.format(p.round)} of ${count.format(p.maxRounds)}`;
    const tail = objectionsPhrase(p.openObjections);
    return tail ? `${head} · ${tail}` : head;
  }
  if (p.stage === "proposals") {
    if (p.proposalsIn !== null && p.proposalsExpected !== null) {
      return `Proposals in · ${count.format(p.proposalsIn)} of ${count.format(p.proposalsExpected)} posted`;
    }
    if (p.proposalsExpected !== null) return `Proposals out · ${plural(p.proposalsExpected, "lab")} drafting`;
    return "Proposals out";
  }
  if (p.stage) return `Stage · ${p.stage}`;
  return null;
}

function codeSubtitle(p: CodeProgress): string {
  return `${plural(p.filesTouched, "file")} touched · ${plural(p.toolCalls, "tool call")}`;
}

/**
 * The line under a seat's status badge. `null` means "nothing real to say" - the caller hides
 * the element rather than printing a placeholder (a Degraded/Timed-out seat's output slot
 * already carries the error; an idle seat with no run yet says nothing).
 */
export function progressSubtitle(status: SeatStatus, progress: SeatProgress | null): string | null {
  if (!progress) return null;
  if (status === "problem" || status === "timeout") return null;
  if (progress.kind === "relay") return relaySubtitle(status, progress);
  if (status === "idle") return null; // a finished turn's counts stay in the output, not the badge line
  return codeSubtitle(progress);
}

/**
 * The DISPATCHED card's right-hand line, e.g. "cap 3 rounds · $5 ceiling". Read from the
 * running plan seats' own relay headers; printed only when every active run agrees (the common
 * case - the same chain on every seat). Mixed caps, or no relay run yet, return null and the
 * card just shows no cap line.
 */
export function dispatchCapLine(active: SeatProgress[]): string | null {
  const relays = active.filter((p): p is RelayProgress => p.kind === "relay");
  if (relays.length === 0) return null;
  const rounds = new Set(relays.map((p) => p.maxRounds));
  const caps = new Set(relays.map((p) => p.capUsd));
  const parts: string[] = [];
  if (rounds.size === 1) {
    const r = relays[0].maxRounds;
    if (r !== null) parts.push(`cap ${plural(r, "round")}`);
  }
  if (caps.size === 1) {
    const c = relays[0].capUsd;
    if (c !== null) parts.push(`${money.format(c)} ceiling`);
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * The one-line note under the chips: who is waiting on the operator, in real seat names. Never
 * speculates about dependencies between seats - this app has no dependency graph to read.
 */
export function dispatchNote(waiting: string[], workingCount: number): string {
  if (waiting.length === 0) {
    return workingCount === 1 ? "One seat is working. Nothing is waiting on you." : "Nothing is waiting on you right now.";
  }
  const names = waiting.length === 1 ? waiting[0] : `${waiting.slice(0, -1).join(", ")} and ${waiting[waiting.length - 1]}`;
  const verb = waiting.length === 1 ? "has" : "have";
  const rest = workingCount > 0 ? ` ${workingCount === 1 ? "The other seat keeps" : "The other seats keep"} going.` : "";
  return `${names} ${verb} paused for you.${rest}`;
}

/** The left-rail pill's first line, from real counts only. */
export function needsPillLine(needsYou: number, degraded: number): string {
  if (needsYou === 0 && degraded === 0) return "◆ All quiet";
  const parts: string[] = [];
  if (needsYou > 0) parts.push(`${count.format(needsYou)} ${needsYou === 1 ? "seat needs" : "seats need"} you`);
  if (degraded > 0) parts.push(`${count.format(degraded)} degraded`);
  return `◆ ${parts.join(" · ")}`;
}

/** cnc's own status line: a real delegation count now that seat statuses are tracked here. */
export function homeStatusLine(status: SeatStatus, delegated: number): string {
  if (status === "problem" || status === "timeout") return "degraded";
  if (delegated > 0) return `orchestrating ${plural(delegated, "seat")}`;
  return status === "working" ? "thinking" : "ready · nothing delegated";
}

// Phase 2 Step 3 of the long-horizon build plan (relay run
// 2026-09-10T20-03-03-692Z/revise-1.md, "Export a run as markdown"): pure, DOM-free
// markdown-building functions for "Copy as Markdown" and "Export", used by both a plain
// seat's output and a planner seat's Debate panel. Kept separate from main.ts so the
// acceptance test ("'Copy as Markdown' output matches the Debate panel's rendered content
// exactly") can be reasoned about as a plain string-in/string-out function.
//
// "Reuses the already-sanitized rendered text" (the plan's own wording): a plain seat's
// export is built from the exact source text already fed to renderSeatOutput
// (seatOutputRender.ts) - not a re-serialization of the sanitized DOM back into markdown,
// so there is no lossy round-trip to keep in sync.

export interface DebateSignoffEntry {
  provider: string;
  model: string;
  signedOff: boolean | null;
}
export interface DebateScoreboardLab {
  lab: string;
  accepted: number;
  proposed: number;
}
export interface DebateFailureEntry {
  lab?: string;
  problem?: string;
  criterion?: string;
}
export interface DebateReportDetail {
  runId: string;
  passed: boolean;
  signoff: DebateSignoffEntry[] | null;
  scoreboard: { labs: DebateScoreboardLab[] } | null;
  failures: DebateFailureEntry[] | null;
}

// Generous, matching src/orchestrator/index.js's FORWARD_MAX_CHARS precedent (16_000, "the
// largest real deliverable seen so far") - a debate export can run larger than a single
// deliverable since it includes every critic's objections, not just the winning text. The
// exact number matters less than the rule itself (PLAN.md Phase 2 Step 3's honesty rule): any
// cut is a loud, literal "TRUNCATED" line, never a silently shortened file.
export const EXPORT_MAX_CHARS = 100_000;

export function applyExportTruncation(markdown: string, maxChars: number = EXPORT_MAX_CHARS): string {
  if (markdown.length <= maxChars) return markdown;
  return (
    `${markdown.slice(0, maxChars)}\n\n` +
    `**TRUNCATED** — export capped at ${maxChars} characters; see the run's own files under ` +
    `relay's \`runs/\` directory for the untruncated original.\n`
  );
}

function blockquote(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.length ? `> ${line}` : ">"))
    .join("\n");
}

/** A plain seat (advisor/cnc/build-N, or a planner seat's own raw output pane). */
export function buildSeatMarkdown(seatLabel: string, prompt: string | null, outputText: string): string {
  const parts: string[] = [`# ${seatLabel}`];
  if (prompt) {
    parts.push("", "## Prompt", "", blockquote(prompt));
  }
  parts.push("", "## Output", "", outputText);
  return applyExportTruncation(parts.join("\n"));
}

function signoffLabel(signedOff: boolean | null): string {
  return signedOff === true ? "signed off" : signedOff === false ? "objected" : "abstained";
}

// The Debate panel's export ("prompt as blockquote, each critic as a heading with grade +
// objections, revision rounds, final verdict" - PLAN.md Phase 2 Step 3). The only structured
// data this app actually has for a finished relay run is DebateReportDetail - see
// relayChainSubprocess.js's own comment on report.json's shape - so "grade" maps to signoff,
// "objections" to failures, and "revision rounds" to the accepted/proposed scoreboard (relay's
// own per-round tally). There is no separate round-by-round transcript surfaced to this app;
// inventing one here would violate the same honesty rule this step legislates, so this sticks
// to exactly the fields renderDebatePanel (main.ts) itself renders, matching it exactly rather
// than adding structure the UI doesn't have either.
export function buildDebateMarkdown(
  seatLabel: string,
  prompt: string | null,
  report: DebateReportDetail | null,
): string {
  const parts: string[] = [`# ${seatLabel} — Council debate`];
  if (prompt) {
    parts.push("", "## Prompt", "", blockquote(prompt));
  }

  if (!report) {
    parts.push("", "_No relay run finished for this seat yet._");
    return applyExportTruncation(parts.join("\n"));
  }

  parts.push("", `## Run \`${report.runId}\``);

  const signoff = report.signoff ?? [];
  const failures = report.failures ?? [];
  for (const s of signoff) {
    parts.push("", `### ${s.provider} (${s.model}) — ${signoffLabel(s.signedOff)}`);
    const objections = failures.filter((f) => f.lab === s.provider);
    if (objections.length) {
      for (const o of objections) {
        parts.push(`- ${o.problem ?? o.criterion ?? "(no reason recorded)"}`);
      }
    } else if (s.signedOff === false) {
      parts.push("- (no specific objection text recorded)");
    }
  }

  const unattributed = failures.filter((f) => !f.lab || !signoff.some((s) => s.provider === f.lab));
  if (unattributed.length) {
    parts.push("", "### Other objections");
    for (const o of unattributed) {
      parts.push(`- ${o.lab ? `${o.lab}: ` : ""}${o.problem ?? o.criterion ?? "(no reason recorded)"}`);
    }
  }

  if (report.scoreboard?.labs?.length) {
    parts.push("", "## Revision scoreboard (accepted/proposed)");
    for (const l of report.scoreboard.labs) {
      parts.push(`- ${l.lab}: ${l.accepted}/${l.proposed}`);
    }
  }

  parts.push("", "## Final verdict", "", report.passed ? "**PASSED**" : "**FAILED**");

  return applyExportTruncation(parts.join("\n"));
}

/** Filename convention shared by every "Export" caller in main.ts - kept here so the Rust
 * side (which only sanitizes to a bare file name) and the frontend agree on the shape. */
export function exportFilename(seatId: string, kind: "seat" | "debate"): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `${seatId}-${kind}-${stamp}.md`;
}

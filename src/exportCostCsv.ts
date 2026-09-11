// Backlog item 6 (relay run 2026-09-10T23-20-49-005Z, "per-seat cost breakdown + CSV export"):
// pure, DOM-free CSV-building functions, same separation exportMarkdown.ts already established
// for the same reason - the acceptance test ("Export CSV produces a file with seat/stage/tokens/
// cost columns matching what's shown") can be reasoned about as a plain string-in/string-out
// function, independent of the panel that renders the same data as a table.

export interface CostBreakdownRow {
  seat: string;
  stage: string | null;
  tokens: number;
  usd: number | null; // null = "not reported" or "unpriced" - never a fabricated 0
}

/** One row per seat with a real per-stage breakdown (relay chain seats), one row per seat
 * without one (every other seat) - never a row for a seat that has recorded no usage at all
 * this session (the honesty invariant cost-tracker.js's own header comment states: "usage not
 * reported, never 0"). */
export function buildCostBreakdownRows(
  seats: {
    seatId: string;
    total: { inputTokens: number; outputTokens: number; usd: number; reported: boolean; priced: boolean } | null;
    stages?: { label: string | null; inputTokens: number | null; outputTokens: number | null; priced: boolean; usd: number | null }[];
  }[],
): CostBreakdownRow[] {
  const rows: CostBreakdownRow[] = [];
  for (const seat of seats) {
    if (!seat.total?.reported) continue;
    if (seat.stages && seat.stages.length > 0) {
      for (const stage of seat.stages) {
        if (typeof stage.inputTokens !== "number" || typeof stage.outputTokens !== "number") continue;
        rows.push({
          seat: seat.seatId,
          stage: stage.label,
          tokens: stage.inputTokens + stage.outputTokens,
          usd: stage.priced ? stage.usd : null,
        });
      }
    } else {
      rows.push({
        seat: seat.seatId,
        stage: null,
        tokens: seat.total.inputTokens + seat.total.outputTokens,
        usd: seat.total.priced ? seat.total.usd : null,
      });
    }
  }
  return rows;
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function buildCostBreakdownCsv(rows: CostBreakdownRow[]): string {
  const lines = ["Seat,Stage,Tokens,Cost (USD)"];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.seat),
        csvField(row.stage ?? ""),
        String(row.tokens),
        row.usd === null ? "unpriced" : row.usd.toFixed(row.usd < 0.01 && row.usd > 0 ? 4 : 2),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}

export function costBreakdownCsvFilename(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  return `cost-breakdown-${stamp}.csv`;
}

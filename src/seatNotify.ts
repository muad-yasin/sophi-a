// Native OS notifications for seat completion/error, built specifically for the multi-session
// oversight problem: an operator running several seats (or several Sophi-A instances, or several
// unrelated terminal sessions) at once can't watch every tile at once, and tab-switching back in
// to check "is it done yet" is exactly the busywork a desktop notification exists to remove.
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { getCurrentWindow } from "@tauri-apps/api/window";

let permissionGranted = false;

export async function initNotifications(): Promise<void> {
  permissionGranted = await isPermissionGranted();
  if (!permissionGranted) {
    const result = await requestPermission();
    permissionGranted = result === "granted";
  }
}

const SEAT_LABELS: Record<string, string> = {
  cnc: "Command & Control",
  advisor: "Advisor",
  "plan-1": "Planner 1",
  "plan-2": "Planner 2",
  "plan-3": "Planner 3",
  "build-1": "Builder 1",
  "build-2": "Builder 2",
  "build-3": "Builder 3",
};

// Only fires on a real working -> idle/problem transition (main.ts checks the seat's previous
// status before calling this) - never on the initial status replay a fresh connection gets for
// every already-idle seat, which would otherwise fire eight notifications the instant the window
// opens.
export async function notifySeatTransition(seatId: string, outcome: "idle" | "problem"): Promise<void> {
  if (!permissionGranted) return;
  // No notification for work the operator is already looking at - the tile itself already shows
  // it, a system notification on top would just be noise. Fails open (still notifies) if the
  // focus check itself errors, since a missed notification is worse than one extra.
  try {
    if (await getCurrentWindow().isFocused()) return;
  } catch {
    // fall through and notify anyway
  }
  const label = SEAT_LABELS[seatId] ?? seatId;
  const title = outcome === "problem" ? `${label} hit a problem` : `${label} finished`;
  sendNotification({ title, body: "Sophi-A" });
}

// Backlog item 7 (relay run 2026-09-10T23-20-49-005Z, follow-on to item 6's cost breakdown):
// notification-only - this never stops anything, it only tells the operator a seat crossed a
// spend threshold they set themselves. Deliberately does not skip on window focus the way
// notifySeatTransition does above: a cost overrun is worth interrupting for even if the operator
// is staring right at the tile, unlike "a turn finished" which the tile already shows.
export async function notifyBudgetExceeded(seatId: string, usd: number, thresholdUsd: number): Promise<void> {
  if (!permissionGranted) return;
  const label = SEAT_LABELS[seatId] ?? seatId;
  sendNotification({
    title: `${label} passed its budget`,
    body: `$${usd.toFixed(2)} spent, threshold was $${thresholdUsd.toFixed(2)}`,
  });
}

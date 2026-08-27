import type { SaveStatus } from "./saveStatus.js";

/**
 * What the app is allowed to claim about the cloud.
 *
 * Everything in Fulbito writes itself, so the app owes you a receipt for every
 * write — and with sync on there are *two* promises behind that receipt, not
 * one. "It is on this device" and "it is on your other phone" are different
 * statements, they come true at different moments, and only the first of them
 * is ever instant.
 *
 * The rule this module exists to enforce is that the second claim is only ever
 * made once the server has said so. Not when the write left, not when the plan
 * came back empty against a cached view of the cloud — when Firestore reports
 * a snapshot that came from the server with nothing of ours still queued. An
 * app that flashes "sincronizado" over a write sitting in an offline queue is
 * worse than one that says nothing, because it is the sentence you rely on
 * when you decide not to check.
 */

export type CloudState =
  /** No account, no config, or an account this deployment does not sync. */
  | { kind: "off" }
  | { kind: "blocked" }
  /** Signing in, or waiting for the first full snapshot. */
  | { kind: "connecting" }
  /** Saved here; the server has not confirmed it yet. */
  | { kind: "pending" }
  /** Saved here; a write is in the air right now. */
  | { kind: "syncing" }
  /** The server has it. This is the only state that means "on your other phone". */
  | { kind: "synced" }
  | { kind: "error"; message: string };

export interface CloudSignals {
  /** A full snapshot has landed at least once, so there is a cloud to compare to. */
  connected: boolean;
  /** A write is in flight right now. */
  writing: boolean;
  /** Everything on this device is already in the last-seen cloud view. */
  planEmpty: boolean;
  /**
   * The last snapshot came from the server rather than the local cache.
   *
   * With an offline cache turned on, Firestore answers instantly out of
   * IndexedDB and marks the snapshot `fromCache`. Reading a plan as "nothing
   * to do" against that view says nothing whatsoever about the server.
   */
  fromServer: boolean;
  /** The last snapshot still carried writes the server has not acknowledged. */
  pendingWrites: boolean;
  /** The last upload attempt failed, and what to say about it. */
  error: string | null;
}

/**
 * The verdict, in the order the questions actually settle.
 *
 * "Synced" is asked first, and deliberately outranks a stored error: a failed
 * upload that a later snapshot shows landed anyway — a retry that worked, or
 * another device carrying the same edit up — is not a failure any more, and
 * leaving the message up would train somebody to ignore it.
 *
 * The error check comes before the connection check for the opposite reason. A
 * subscription that fell over never sets `connected`, so testing that first
 * would report "Conectando…" forever and swallow the one message that explains
 * why nothing is arriving.
 */
export function cloudStateFrom(signals: CloudSignals): CloudState {
  if (signals.planEmpty && signals.fromServer && !signals.pendingWrites && !signals.writing) {
    return { kind: "synced" };
  }
  if (signals.error !== null) return { kind: "error", message: signals.error };
  if (!signals.connected) return { kind: "connecting" };
  if (signals.writing) return { kind: "syncing" };
  return { kind: "pending" };
}

/**
 * How long to wait before trying a failed upload again.
 *
 * Without this a rejected write simply sat there until the next tap or the
 * next snapshot happened to come along, which on a phone that has been put
 * back in a pocket is "never". Doubling from a second and capping at half a
 * minute keeps a flaky connection cheap and a walk out of signal range from
 * hammering anything.
 */
const FIRST_RETRY = 1000;
const MAX_RETRY = 30_000;

export function retryDelay(attempt: number): number {
  if (attempt <= 0) return FIRST_RETRY;
  return Math.min(FIRST_RETRY * 2 ** attempt, MAX_RETRY);
}

/**
 * What the floating pill says, given both promises.
 *
 * `hidden` is the resting state. The two things worth noticing:
 *
 * **A save that is on disk but not yet in the cloud keeps the pill up** — past
 * the couple of seconds a plain "Guardado" is held for, for as long as it
 * takes. That is the whole point: the pill going away is the app saying it is
 * done, and it is not done. Somebody marking who paid on bad phone data at the
 * cancha should be able to see that the answer has not left the ground yet.
 *
 * **A cloud failure does not keep it up**, because `App` already puts a
 * full-width amber line under the nav explaining it, and that line stays for
 * as long as it is true. Two permanent things saying one thing is one too
 * many.
 */
export type SaveReceipt =
  | { kind: "hidden" }
  /** The write did not reach this device's own storage. The loud one. */
  | { kind: "failed"; message: string }
  | { kind: "saved"; cloud: CloudLeg };

/** Where the second promise has got to. `none` means there isn't one. */
export type CloudLeg = "none" | "waiting" | "failed" | "done";

export function saveReceipt(save: SaveStatus, cloud: CloudState): SaveReceipt {
  if (save.kind === "error") return { kind: "failed", message: save.message };

  const shown = save.kind === "saved";

  switch (cloud.kind) {
    case "off":
    case "blocked":
      return shown ? { kind: "saved", cloud: "none" } : { kind: "hidden" };
    case "synced":
      return shown ? { kind: "saved", cloud: "done" } : { kind: "hidden" };
    case "error":
      return shown ? { kind: "saved", cloud: "failed" } : { kind: "hidden" };
    case "connecting":
      // Nothing has been written yet this session, so there is nothing to be
      // waiting *for*. Sitting a pill on screen while the SDK wakes up would
      // put one there on every cold start.
      return shown ? { kind: "saved", cloud: "waiting" } : { kind: "hidden" };
    case "pending":
    case "syncing":
      return { kind: "saved", cloud: "waiting" };
  }
}

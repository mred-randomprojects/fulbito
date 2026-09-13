/**
 * What the app says about how it is used, and the one place that decides
 * whether it says anything at all.
 *
 * Three decisions live here, and none of them knows which vendor is on the
 * other end:
 *
 * - **The events are a closed list.** `TrackEvent` is the contract: a screen
 *   sends one of these and nothing else, so the day the vendor changes, the
 *   questions we can answer do not. Adding an event means adding a member
 *   here, and the typechecker turns a typo at a call site into a build error
 *   rather than a graph that is quietly empty.
 * - **Nothing is sent before it is allowed.** `trackingGate` is answered
 *   synchronously, before an SDK is downloaded — the same bargain
 *   `lib/syncConsent.ts` makes with Firebase. A build made without a key, or
 *   a browser where the switch in Tus datos is off, never fetches the vendor
 *   at all.
 * - **Early events wait rather than vanish.** The SDK arrives after the first
 *   screen has already been looked at. The tracker holds what happened until
 *   a sink is attached, then hands it over in order; if it is told nothing is
 *   coming, it drops the lot and stops keeping any.
 *
 * The vendor adapter is `analytics/posthog.ts`; the wiring is `useTracking`.
 * Neither decides anything.
 */

/** Every event this app can send. Adding one here is the whole registration. */
export type TrackEvent =
  | { name: "page_viewed"; screen: string }
  | { name: "player_created"; players: number }
  | { name: "match_created"; matches: number }
  | { name: "teams_generated"; squad: number; basis: string }
  | { name: "lineup_shared"; via: "text" | "image"; ratings: boolean }
  | { name: "result_recorded" }
  | { name: "review_written" }
  | { name: "saved_teams_loaded" }
  | { name: "torneito_shared"; via: "text" | "image"; teams: number }
  | { name: "poll_created"; players: number }
  | { name: "crowd_adopted" }
  | { name: "backup_exported" }
  | { name: "backup_imported" }
  | { name: "sync_enabled" }
  | { name: "app_installed" }
  | { name: "list_created"; cap: number }
  | { name: "list_shared"; via: "text" | "link" }
  /** `own`: their own name, as against somebody they brought along. */
  | { name: "list_joined"; own: boolean }
  | { name: "list_left" }
  | { name: "list_applied"; players: number };

export type TrackEventName = TrackEvent["name"];
export type TrackProps = Record<string, string | number | boolean>;

/** The bits of a signed-in account worth attaching to a session. */
export interface TrackPerson {
  uid: string;
  email: string | null;
  name: string;
}

/**
 * What a vendor has to be able to do. `start` and `stop` are the switch in
 * Tus datos being flipped while the SDK is already on the page; the tracker
 * calls them, and never the vendor directly.
 */
export interface TrackSink {
  start(): void;
  stop(): void;
  capture(name: TrackEventName, props: TrackProps): void;
  identify(id: string, props: Record<string, string>): void;
  reset(): void;
}

/**
 * Whether analytics may run in this browser at all.
 *
 * Off when the build was never given a key — a fork's normal state — and off
 * when the person switched it off. Both answers are known before anything is
 * downloaded, which is the point.
 */
export function trackingGate(input: { key: string | undefined; optedOut: boolean }): "on" | "off" {
  if (input.key === undefined || input.key === "") return "off";
  if (input.optedOut) return "off";
  return "on";
}

/**
 * `/matches/abc-123` → `/matches/:id`.
 *
 * The vendor sees screens, not documents. A path per match would make every
 * partido its own page in a report that is meant to say "people open the
 * match screen", and the id itself tells nobody anything.
 */
export function screenOf(pathname: string): string {
  const segments = pathname.split("/").filter((segment) => segment !== "");
  if (segments.length === 0) return "/";
  if (segments.length === 1) return `/${segments[0]}`;
  return `/${segments[0]}/:id`;
}

/** Splits `{ name, ...props }` into the two arguments a sink takes. */
export function splitEvent(event: TrackEvent): { name: TrackEventName; props: TrackProps } {
  const { name, ...props } = event;
  return { name, props };
}

/**
 * What is said about a signed-in person: a name to read the session by, and
 * the address only when the account has one.
 */
export function personProps(person: TrackPerson): Record<string, string> {
  const props: Record<string, string> = { name: person.name };
  if (person.email !== null) props.email = person.email;
  return props;
}

/** Everything the tracker can be asked to do, so the queue holds them in order. */
type Queued =
  | { kind: "capture"; event: TrackEvent }
  | { kind: "identify"; person: TrackPerson }
  | { kind: "reset" };

type State =
  | { kind: "pending"; queue: Queued[] }
  | { kind: "on"; sink: TrackSink }
  | { kind: "off" };

export interface Tracker {
  track(event: TrackEvent): void;
  identify(person: TrackPerson): void;
  reset(): void;
  /** Hand over everything held so far, in order, and send the rest as it comes. */
  attach(sink: TrackSink): void;
  /** Nothing is coming, or nothing may be sent any more. Drops what is held. */
  off(): void;
  /** For the switch in Tus datos, which needs to know what it is toggling. */
  state(): State["kind"];
}

/** How much is held for an SDK that has not arrived. Past it, the oldest go. */
export const QUEUE_LIMIT = 100;

/**
 * The tracker's whole life is three states: waiting for a sink, feeding one,
 * or told to stop. Waiting is the only one that remembers anything.
 */
export function createTracker(options: { limit?: number } = {}): Tracker {
  const limit = options.limit ?? QUEUE_LIMIT;
  let state: State = { kind: "pending", queue: [] };

  const deliver = (sink: TrackSink, item: Queued): void => {
    switch (item.kind) {
      case "capture": {
        const { name, props } = splitEvent(item.event);
        sink.capture(name, props);
        return;
      }
      case "identify":
        sink.identify(item.person.uid, personProps(item.person));
        return;
      case "reset":
        sink.reset();
        return;
    }
  };

  const push = (item: Queued): void => {
    switch (state.kind) {
      case "pending":
        state.queue.push(item);
        if (state.queue.length > limit) state.queue.splice(0, state.queue.length - limit);
        return;
      case "on":
        deliver(state.sink, item);
        return;
      case "off":
        return;
    }
  };

  return {
    track: (event) => push({ kind: "capture", event }),
    identify: (person) => push({ kind: "identify", person }),
    reset: () => push({ kind: "reset" }),
    attach: (sink) => {
      const held = state.kind === "pending" ? state.queue : [];
      state = { kind: "on", sink };
      sink.start();
      for (const item of held) deliver(sink, item);
    },
    off: () => {
      if (state.kind === "on") state.sink.stop();
      state = { kind: "off" };
    },
    state: () => state.kind,
  };
}

/** The one tracker the app uses. Screens call `track`; the wiring attaches. */
export const tracker: Tracker = createTracker();

export function track(event: TrackEvent): void {
  tracker.track(event);
}

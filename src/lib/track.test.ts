import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createTracker,
  personProps,
  screenOf,
  splitEvent,
  trackingGate,
  type TrackEventName,
  type TrackProps,
  type TrackSink,
} from "./track.js";

type Call =
  | { kind: "start" }
  | { kind: "stop" }
  | { kind: "capture"; name: TrackEventName; props: TrackProps }
  | { kind: "identify"; id: string; props: Record<string, string> }
  | { kind: "reset" };

function fakeSink(): { sink: TrackSink; calls: Call[] } {
  const calls: Call[] = [];
  const sink: TrackSink = {
    start: () => calls.push({ kind: "start" }),
    stop: () => calls.push({ kind: "stop" }),
    capture: (name, props) => calls.push({ kind: "capture", name, props }),
    identify: (id, props) => calls.push({ kind: "identify", id, props }),
    reset: () => calls.push({ kind: "reset" }),
  };
  return { sink, calls };
}

describe("trackingGate", () => {
  it("is off in a build that was never given a key", () => {
    assert.equal(trackingGate({ key: undefined, optedOut: false }), "off");
    assert.equal(trackingGate({ key: "", optedOut: false }), "off");
  });

  it("is off when the person switched it off, key or no key", () => {
    assert.equal(trackingGate({ key: "phc_x", optedOut: true }), "off");
  });

  it("is on only with a key and no objection", () => {
    assert.equal(trackingGate({ key: "phc_x", optedOut: false }), "on");
  });
});

describe("screenOf", () => {
  it("keeps a screen's own path", () => {
    assert.equal(screenOf("/players"), "/players");
    assert.equal(screenOf("/matches"), "/matches");
  });

  it("replaces a document id with a placeholder", () => {
    assert.equal(screenOf("/matches/abc-123"), "/matches/:id");
  });

  it("reads the root and an empty path as the root", () => {
    assert.equal(screenOf("/"), "/");
    assert.equal(screenOf(""), "/");
  });

  it("ignores a trailing slash", () => {
    assert.equal(screenOf("/matches/"), "/matches");
  });
});

describe("splitEvent", () => {
  it("separates the name from everything else", () => {
    assert.deepEqual(splitEvent({ name: "teams_generated", squad: 10, basis: "total" }), {
      name: "teams_generated",
      props: { squad: 10, basis: "total" },
    });
  });

  it("hands over an empty bag for an event with nothing to say", () => {
    assert.deepEqual(splitEvent({ name: "result_recorded" }), {
      name: "result_recorded",
      props: {},
    });
  });
});

describe("personProps", () => {
  it("sends the address only when the account has one", () => {
    assert.deepEqual(personProps({ uid: "u1", email: "a@b.c", name: "A" }), {
      name: "A",
      email: "a@b.c",
    });
    assert.deepEqual(personProps({ uid: "u1", email: null, name: "A" }), { name: "A" });
  });
});

describe("createTracker", () => {
  it("holds what happened before the sink arrived and hands it over in order", () => {
    const tracker = createTracker();
    tracker.track({ name: "page_viewed", screen: "/matches" });
    tracker.identify({ uid: "u1", email: null, name: "Maxi" });
    tracker.track({ name: "match_created", matches: 1 });

    const { sink, calls } = fakeSink();
    tracker.attach(sink);

    assert.deepEqual(calls, [
      { kind: "start" },
      { kind: "capture", name: "page_viewed", props: { screen: "/matches" } },
      { kind: "identify", id: "u1", props: { name: "Maxi" } },
      { kind: "capture", name: "match_created", props: { matches: 1 } },
    ]);
  });

  it("sends straight through once attached", () => {
    const tracker = createTracker();
    const { sink, calls } = fakeSink();
    tracker.attach(sink);
    calls.length = 0;

    tracker.track({ name: "result_recorded" });
    tracker.reset();

    assert.deepEqual(calls, [
      { kind: "capture", name: "result_recorded", props: {} },
      { kind: "reset" },
    ]);
  });

  /**
   * The case worth the test: a build with no key, or a person who said no,
   * must not leave a queue growing for the whole session behind a sink that
   * is never coming.
   */
  it("drops everything once told nothing is coming, before and after", () => {
    const tracker = createTracker();
    tracker.track({ name: "page_viewed", screen: "/matches" });
    tracker.off();
    tracker.track({ name: "match_created", matches: 1 });

    const { sink, calls } = fakeSink();
    tracker.attach(sink);
    assert.deepEqual(calls, [{ kind: "start" }]);
  });

  it("tells the sink to stop when switched off while it is on", () => {
    const tracker = createTracker();
    const { sink, calls } = fakeSink();
    tracker.attach(sink);
    tracker.off();
    tracker.track({ name: "result_recorded" });

    assert.deepEqual(calls, [{ kind: "start" }, { kind: "stop" }]);
    assert.equal(tracker.state(), "off");
  });

  it("can be switched back on with the same sink, and starts it again", () => {
    const tracker = createTracker();
    const { sink, calls } = fakeSink();
    tracker.attach(sink);
    tracker.off();
    tracker.attach(sink);
    tracker.track({ name: "result_recorded" });

    assert.deepEqual(calls, [
      { kind: "start" },
      { kind: "stop" },
      { kind: "start" },
      { kind: "capture", name: "result_recorded", props: {} },
    ]);
    assert.equal(tracker.state(), "on");
  });

  it("keeps only the newest while waiting, so a slow SDK cannot fill memory", () => {
    const tracker = createTracker({ limit: 2 });
    tracker.track({ name: "match_created", matches: 1 });
    tracker.track({ name: "match_created", matches: 2 });
    tracker.track({ name: "match_created", matches: 3 });

    const { sink, calls } = fakeSink();
    tracker.attach(sink);
    assert.deepEqual(calls, [
      { kind: "start" },
      { kind: "capture", name: "match_created", props: { matches: 2 } },
      { kind: "capture", name: "match_created", props: { matches: 3 } },
    ]);
  });
});

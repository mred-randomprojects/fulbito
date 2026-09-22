import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultFormation } from "./formations.js";
import {
  createSplitDraftStore,
  defaultSplitDraft,
  restoreSplitResult,
  SPLIT_DRAFT_KEY,
  SPLIT_DRAFT_VERSION,
  storeSplitResult,
  type SplitDraft,
  type StoredSplitResult,
} from "./splitDraft.js";
import { RATING_SCALE, type Player, type PlayerId } from "../types.js";

const id = (value: string) => value as PlayerId;

function storage(initial?: unknown) {
  const values = new Map<string, string>();
  if (initial !== undefined) values.set(SPLIT_DRAFT_KEY, JSON.stringify(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
}

function player(value: string, rating: number): Player {
  return {
    id: id(value),
    firstName: value,
    lastName: "",
    nickname: "",
    avatar: "",
    rating,
    ratingScale: RATING_SCALE,
    roleRatings: {},
    attributes: {},
    avoid: [],
    together: [],
    tags: [],
    notes: "",
    updatedAt: "2026-09-22T00:00:00.000Z",
  };
}

describe("Repartir draft storage", () => {
  it("starts from the last match only when there is no saved draft", () => {
    const disk = storage();
    const store = createSplitDraftStore(() => disk);
    const draft = store.load([id("a"), id("b"), id("c")], [id("a"), id("c")]);

    assert.deepEqual(draft.squad, [id("a"), id("c")]);
    assert.equal(draft.teams, 2);
    assert.deepEqual(draft.sizes, [1, 1]);
    assert.equal(draft.result, null);
  });

  it("falls back safely when the stored draft is not valid JSON", () => {
    const disk = storage();
    disk.setItem(SPLIT_DRAFT_KEY, "{not-json");
    const draft = createSplitDraftStore(() => disk).load(
      [id("a"), id("b")],
      [id("b")],
    );

    assert.deepEqual(draft.squad, [id("b")]);
    assert.equal(draft.result, null);
  });

  it("round-trips the whole meaningful screen, including pins and the visible split", () => {
    const disk = storage();
    const store = createSplitDraftStore(() => disk);
    const result: StoredSplitResult = {
      options: [
        [[id("a"), id("b")], [id("c"), id("d")]],
        [[id("a"), id("c")], [id("b"), id("d")]],
      ],
      exhaustive: false,
      evaluated: 246,
    };
    const draft: SplitDraft = {
      ...defaultSplitDraft([id("a"), id("b"), id("c"), id("d")]),
      version: SPLIT_DRAFT_VERSION,
      pins: { [id("a")]: 1 },
      basis: "average",
      respectAvoids: false,
      respectTogether: false,
      spreadKeepers: false,
      requestedRatings: true,
      format: "winner-stays",
      rule: "a 2 goles",
      names: { 0: "Los Pibes", 3: "La Reserva" },
      result,
      optionIndex: 1,
      picked: id("c"),
      handMade: [1],
    };

    assert.equal(store.save(draft), true);
    assert.deepEqual(
      createSplitDraftStore(() => disk).load(draft.squad, []),
      draft,
    );
  });

  it("keeps navigation safe in memory when localStorage is unavailable", () => {
    const store = createSplitDraftStore(() => {
      throw new Error("storage blocked");
    });
    const draft = {
      ...defaultSplitDraft([id("a"), id("b")]),
      pins: { [id("b")]: 1 },
      names: { 1: "Visitante" },
    };

    assert.equal(store.save(draft), false);
    assert.deepEqual(store.load([id("a"), id("b")], []), draft);
  });

  it("drops stale result data and pins without discarding the surviving setup", () => {
    const disk = storage({
      ...defaultSplitDraft([id("a"), id("b"), id("gone")]),
      sizes: [2, 1],
      pins: { a: 0, gone: 1 },
      result: {
        options: [[ ["a", "gone"], ["b"] ]],
        exhaustive: true,
        evaluated: 1,
      },
      optionIndex: 9,
      picked: "gone",
      handMade: [0, 9],
    });

    const draft = createSplitDraftStore(() => disk).load([id("a"), id("b")], []);
    assert.deepEqual(draft.squad, [id("a"), id("b")]);
    assert.deepEqual(draft.sizes, [2, 1]);
    assert.deepEqual(draft.pins, { [id("a")]: 0 });
    assert.equal(draft.result, null);
    assert.equal(draft.optionIndex, 0);
    assert.equal(draft.picked, null);
    assert.deepEqual(draft.handMade, []);
  });
});

describe("Repartir result restoration", () => {
  it("keeps the exact teams but re-scores them from current player data", () => {
    const players = [player("a", 80), player("b", 60), player("c", 50), player("d", 40)];
    const stored: StoredSplitResult = {
      options: [[[id("a"), id("d")], [id("b"), id("c")]]],
      exhaustive: true,
      evaluated: 3,
    };
    const request = {
      formations: [defaultFormation(2), defaultFormation(2)],
      basis: "total" as const,
    };

    const before = restoreSplitResult(stored, { ...request, players });
    const after = restoreSplitResult(stored, {
      ...request,
      players: players.map((entry) =>
        entry.id === id("a") ? { ...entry, rating: 100 } : entry,
      ),
    });

    assert.deepEqual(
      before?.options[0].teams.map((team) => team.players.map((entry) => entry.id)),
      stored.options[0],
    );
    assert.ok(
      (after?.options[0].teams[0].evaluation.total ?? 0) >
        (before?.options[0].teams[0].evaluation.total ?? 0),
    );
    assert.deepEqual(storeSplitResult(before), stored);
  });
});

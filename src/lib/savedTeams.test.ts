import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findByMembers, freeTeamName, sameMembers, type TeamLike } from "./savedTeams.js";

describe("sameMembers", () => {
  it("does not care what order anybody was written in", () => {
    assert.equal(sameMembers(["a", "b", "c"], ["c", "a", "b"]), true);
  });

  it("is false when somebody is missing, or somebody extra is there", () => {
    assert.equal(sameMembers(["a", "b"], ["a"]), false);
    assert.equal(sameMembers(["a", "b"], ["a", "b", "c"]), false);
    assert.equal(sameMembers(["a", "b"], ["a", "c"]), false);
  });

  it("holds for two empty teams", () => {
    assert.equal(sameMembers([], []), true);
  });

  /**
   * The case worth the test: a stored team holding the same id twice would
   * pass a naive length-plus-every check against a team of two different
   * people, and answer "ya lo tenés" about a side that is not this one.
   */
  it("refuses to call a team with a repeated id the same as a real one", () => {
    assert.equal(sameMembers(["a", "a"], ["a", "b"]), false);
  });
});

describe("findByMembers", () => {
  const teams: TeamLike[] = [
    { name: "Los Pibes", players: ["a", "b"] },
    { name: "Los del laburo", players: ["c", "d"] },
  ];

  it("finds the team already holding exactly these people", () => {
    assert.equal(findByMembers(teams, ["b", "a"])?.name, "Los Pibes");
  });

  it("is undefined when nobody has them", () => {
    assert.equal(findByMembers(teams, ["a", "c"]), undefined);
  });
});

describe("freeTeamName", () => {
  it("leaves a name nobody is using alone", () => {
    assert.equal(freeTeamName(["Los Pibes"], "Los del laburo"), "Los del laburo");
  });

  it("numbers a name that is taken rather than making a second one", () => {
    assert.equal(freeTeamName(["Los Pibes"], "Los Pibes"), "Los Pibes (2)");
  });

  it("keeps counting past the numbers already out there", () => {
    assert.equal(
      freeTeamName(["Los Pibes", "Los Pibes (2)", "Los Pibes (3)"], "Los Pibes"),
      "Los Pibes (4)",
    );
  });

  it("reads a name the same however it was capitalised or spaced", () => {
    assert.equal(freeTeamName(["  los pibes "], "Los Pibes"), "Los Pibes (2)");
  });

  it("leaves a nameless team nameless", () => {
    assert.equal(freeTeamName(["Los Pibes"], "   "), "");
  });
});

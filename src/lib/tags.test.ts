import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  addTag,
  filterByTags,
  hasTag,
  liveSelection,
  matchesTags,
  MAX_TAGS,
  MAX_TAG_LENGTH,
  normalizeTag,
  normalizeTagList,
  removeTag,
  rosterTags,
  tagKey,
} from "./tags.js";

/**
 * The interesting cases are the ones where two labels are the same tag without
 * being the same string, and the ones where a filter could end up showing
 * nobody with no way back.
 */

describe("normalising a label", () => {
  it("trims and collapses whitespace", () => {
    assert.equal(normalizeTag("  Los  del   sabado "), "Los del sabado");
  });

  it("keeps a label to one line", () => {
    assert.equal(normalizeTag("Del\nlaburo\t2"), "Del laburo 2");
  });

  it("caps the length without leaving a trailing space", () => {
    const long = normalizeTag("Los pibes del barrio de siempre");
    assert.equal(long.length <= MAX_TAG_LENGTH, true);
    assert.equal(long, long.trim());
  });

  it("caps by character, so an emoji never gets cut in half", () => {
    // A plain slice() counts UTF-16 units, so the cap lands mid-surrogate on
    // this one and what comes out is half an emoji: a replacement box that
    // nobody can type back and no other label will ever equal.
    const label = normalizeTag("a".repeat(MAX_TAG_LENGTH - 1) + "\u{1F525}\u{1F525}");
    assert.equal([...label].length, MAX_TAG_LENGTH);
    assert.equal(label.endsWith("\u{1F525}"), true);
    assert.equal(label, "a".repeat(MAX_TAG_LENGTH - 1) + "\u{1F525}");
  });

  it("has nothing to say about an empty label", () => {
    assert.equal(normalizeTag("   "), "");
    assert.equal(tagKey("   "), "");
  });
});

describe("when two labels are the same tag", () => {
  it("ignores case", () => {
    assert.equal(tagKey("Laburo"), tagKey("laburo"));
  });

  it("ignores an accent somebody's phone skipped", () => {
    assert.equal(tagKey("Fútbol"), tagKey("futbol"));
    assert.equal(tagKey("Sábado"), tagKey("sabado"));
  });

  it("keeps the enye a letter of its own", () => {
    // Folding the tilde away with the accents would make "Los Niños" and "Los
    // Ninos" one tag, which is a different word, not a typo.
    assert.notEqual(tagKey("Los Niños"), tagKey("Los Ninos"));
  });

  it("reads the same enye written two ways as one tag", () => {
    // Precomposed U+00F1 against n + combining tilde: the same thing typed on
    // two different keyboards.
    assert.equal(tagKey("Ni\u00F1os"), tagKey("Nin\u0303os"));
  });

  it("does not confuse two tags that merely start alike", () => {
    assert.notEqual(tagKey("Laburo"), tagKey("Laburo 2"));
  });
});

describe("a player's list of tags", () => {
  it("says the same tag once, keeping the first spelling", () => {
    assert.deepEqual(normalizeTagList(["Laburo", "laburo"]), ["Laburo"]);
  });

  it("drops the empties", () => {
    assert.deepEqual(normalizeTagList(["", "  ", "Barrio"]), ["Barrio"]);
  });

  it("keeps the order they were added in", () => {
    assert.deepEqual(normalizeTagList(["Barrio", "Laburo"]), ["Barrio", "Laburo"]);
  });

  it("stops at the cap", () => {
    const many = Array.from({ length: MAX_TAGS + 4 }, (_, i) => `Grupo ${i}`);
    assert.equal(normalizeTagList(many).length, MAX_TAGS);
  });

  it("drops the new one at the cap rather than an old one", () => {
    const full = Array.from({ length: MAX_TAGS }, (_, i) => `Grupo ${i}`);
    assert.deepEqual(addTag(full, "Nuevo"), full);
  });
});

describe("adding and removing", () => {
  it("adds a tag once, however it is spelled the second time", () => {
    assert.deepEqual(addTag(["Laburo"], "LABURO"), ["Laburo"]);
    assert.deepEqual(addTag(["Laburo"], "Barrio"), ["Laburo", "Barrio"]);
  });

  it("refuses a label with nothing in it", () => {
    assert.deepEqual(addTag(["Laburo"], "   "), ["Laburo"]);
  });

  it("removes by tag, not by string", () => {
    assert.deepEqual(removeTag(["Fútbol", "Barrio"], "futbol"), ["Barrio"]);
  });

  it("knows who carries a tag", () => {
    assert.equal(hasTag(["Fútbol"], "FUTBOL"), true);
    assert.equal(hasTag(["Fútbol"], "Barrio"), false);
    // An empty needle is not a tag, so nobody carries it — otherwise the
    // picker would report every player as already having the blank field.
    assert.equal(hasTag(["Fútbol"], "  "), false);
  });
});

describe("the tags the roster knows about", () => {
  it("counts the players carrying each one", () => {
    const tags = rosterTags([
      { tags: ["Laburo"] },
      { tags: ["Laburo", "Barrio"] },
      { tags: [] },
    ]);
    assert.deepEqual(
      tags.map((t) => [t.label, t.count]),
      [
        ["Laburo", 2],
        ["Barrio", 1],
      ],
    );
  });

  it("puts the biggest crew first and breaks ties by name", () => {
    const tags = rosterTags([
      { tags: ["Zona sur", "Barrio", "Laburo"] },
      { tags: ["Laburo"] },
    ]);
    assert.deepEqual(
      tags.map((t) => t.label),
      ["Laburo", "Barrio", "Zona sur"],
    );
  });

  it("folds spellings together and shows the most common one", () => {
    const tags = rosterTags([
      { tags: ["laburo"] },
      { tags: ["Laburo"] },
      { tags: ["Laburo"] },
    ]);
    assert.deepEqual(tags, [{ key: "laburo", label: "Laburo", count: 3 }]);
  });

  it("does not let roster order decide a tied spelling", () => {
    const one = rosterTags([{ tags: ["laburo"] }, { tags: ["Laburo"] }]);
    const other = rosterTags([{ tags: ["Laburo"] }, { tags: ["laburo"] }]);
    assert.deepEqual(one, other);
  });

  it("counts a player who wrote the same tag twice once", () => {
    const tags = rosterTags([{ tags: ["Laburo", "LABURO"] }]);
    assert.deepEqual(tags, [{ key: "laburo", label: "Laburo", count: 1 }]);
  });
});

describe("filtering", () => {
  const roster = [
    { id: "a", tags: ["Laburo"] },
    { id: "b", tags: ["Barrio"] },
    { id: "c", tags: ["Laburo", "Barrio"] },
    { id: "d", tags: [] },
  ];

  it("with nothing ticked is not a filter at all", () => {
    assert.deepEqual(filterByTags(roster, new Set()), roster);
  });

  it("keeps whoever carries the ticked tag", () => {
    const kept = filterByTags(roster, new Set(["laburo"])).map((p) => p.id);
    assert.deepEqual(kept, ["a", "c"]);
  });

  it("reads two ticks as either, not both", () => {
    // "Who is coming from the laburo or the barrio" — an intersection would
    // answer a question nobody asked and usually return nobody.
    const kept = filterByTags(roster, new Set(["laburo", "barrio"])).map((p) => p.id);
    assert.deepEqual(kept, ["a", "b", "c"]);
  });

  it("matches a tag however the player spelled it", () => {
    assert.equal(matchesTags({ tags: ["Fútbol"] }, new Set(["futbol"])), true);
  });

  it("leaves the untagged out of a filtered list", () => {
    assert.equal(matchesTags({ tags: [] }, new Set(["laburo"])), false);
  });
});

describe("a selection pointing at a tag nobody carries any more", () => {
  it("stops filtering rather than showing nobody", () => {
    // The chip is gone the moment the last player drops the tag, so a
    // selection that kept it would hide the whole list with no way to untick.
    const tags = rosterTags([{ tags: ["Barrio"] }]);
    assert.deepEqual(liveSelection(new Set(["laburo"]), tags), new Set());
  });

  it("keeps the ticks that are still real", () => {
    const tags = rosterTags([{ tags: ["Barrio"] }]);
    assert.deepEqual(liveSelection(new Set(["laburo", "barrio"]), tags), new Set(["barrio"]));
  });

  it("leaves an empty selection alone", () => {
    assert.deepEqual(liveSelection(new Set(), rosterTags([{ tags: ["Barrio"] }])), new Set());
  });
});

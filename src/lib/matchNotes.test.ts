import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { hasNote, notePreview, NOTE_PREVIEW_CHARS } from "./matchNotes.js";

describe("hasNote", () => {
  it("sees a note somebody wrote", () => {
    assert.equal(hasNote("la cancha nueva es en Falsa 123"), true);
  });

  it("does not see one in a field nobody touched", () => {
    assert.equal(hasNote(""), false);
  });

  it("does not see one in what a deleted word leaves behind", () => {
    // The field is stored as typed — trimming as you go would make a space
    // impossible to type — so typing a word and removing it leaves whitespace
    // that must not draw an empty card above the tabs.
    assert.equal(hasNote("   "), false);
    assert.equal(hasNote("\n\n  \t"), false);
  });
});

describe("notePreview", () => {
  it("gives back a short note as it was written", () => {
    assert.equal(notePreview("trae la pelota el Colo"), "trae la pelota el Colo");
  });

  it("has nothing to show for a note that is only whitespace", () => {
    assert.equal(notePreview(""), null);
    assert.equal(notePreview("  \n "), null);
  });

  it("reads three lines as one", () => {
    // A row is one line: the indentation of a second line would otherwise
    // arrive as a gap in the middle of the sentence.
    assert.equal(
      notePreview("trae la pelota el Colo\n   falta que pague Nico\n\n\ty el Gordo"),
      "trae la pelota el Colo falta que pague Nico y el Gordo",
    );
  });

  it("cuts a long note and says that it cut it", () => {
    const long = "a".repeat(NOTE_PREVIEW_CHARS + 20);
    const preview = notePreview(long);
    assert.equal(preview, `${"a".repeat(NOTE_PREVIEW_CHARS)}…`);
  });

  it("does not leave the ellipsis floating away from the last word", () => {
    // The cut landing exactly on a space is the case: "…palabra …" reads as a
    // typo rather than as more text.
    const note = `${"x".repeat(9)} ${"y".repeat(20)}`;
    assert.equal(notePreview(note, 10), `${"x".repeat(9)}…`);
  });

  it("adds nothing to a note that fits exactly", () => {
    const note = "b".repeat(NOTE_PREVIEW_CHARS);
    assert.equal(notePreview(note), note);
  });

  it("measures the collapsed note, not the typed one", () => {
    // Twenty blank lines of nothing must not push a two-word note over the cap
    // and put an ellipsis on a note the row can show in full.
    assert.equal(notePreview(`hola${"\n".repeat(200)}chau`), "hola chau");
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickFace, type FaceOption } from "./matchFaces.js";

const PHOTO = "data:image/jpeg;base64,xxx";

function face(id: string, score: number, avatar = PHOTO): FaceOption {
  return { id, avatar, score };
}

describe("pickFace", () => {
  it("puts up the best player on the side", () => {
    const picked = pickFace([face("a", 6), face("b", 9), face("c", 7)]);
    assert.equal(picked?.id, "b");
  });

  it("skips the best player when they never uploaded a photo", () => {
    // The whole point is the photo. A monogram of the 9 is not a preview of
    // anybody, so the 7 who has a face on file gets the circle.
    const picked = pickFace([face("a", 9, ""), face("b", 7), face("c", 6)]);
    assert.equal(picked?.id, "b");
  });

  it("gives up on a side where nobody has a photo, so the shirt stays", () => {
    assert.equal(pickFace([face("a", 9, ""), face("b", 7, "")]), null);
  });

  it("gives up on a side with nobody on it", () => {
    // A match nobody has armado yet: empty lineups, and two shirts is the
    // honest thing to draw.
    assert.equal(pickFace([]), null);
  });

  it("breaks a tie the same way however the lineup was shuffled", () => {
    // Rearmar re-orders the lineup on every press. Two equally-rated players
    // must not swap the face on a row nobody edited.
    const forwards = pickFace([face("zeta", 8), face("alpha", 8)]);
    const backwards = pickFace([face("alpha", 8), face("zeta", 8)]);
    assert.equal(forwards?.id, "alpha");
    assert.equal(backwards?.id, "alpha");
  });

  it("hands back the caller's own object, extras and all", () => {
    // MatchesPage carries the Player along on the option so it can name the
    // face without looking it up a second time.
    const options = [
      { id: "a", avatar: PHOTO, score: 5, name: "Fede" },
      { id: "b", avatar: PHOTO, score: 8, name: "Nacho" },
    ];
    assert.equal(pickFace(options)?.name, "Nacho");
  });
});

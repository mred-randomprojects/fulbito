import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pickImageType, pickPastedImage, type TransferItem } from "./clipboard.js";

/** Stand-in for the File a real DataTransferItem would hand back. */
interface FakeFile {
  name: string;
}

function fileItem(type: string, file: FakeFile | null): TransferItem<FakeFile> {
  return { kind: "file", type, getAsFile: () => file };
}

function stringItem(type: string): TransferItem<FakeFile> {
  return { kind: "string", type, getAsFile: () => null };
}

describe("pickPastedImage", () => {
  it("takes the image out of a screenshot paste", () => {
    const shot = { name: "shot.png" };
    assert.equal(pickPastedImage([fileItem("image/png", shot)], false), shot);
  });

  it("ignores a paste that carries no image", () => {
    const items = [stringItem("text/plain"), fileItem("application/pdf", { name: "a.pdf" })];
    assert.equal(pickPastedImage(items, false), null);
  });

  it("finds the image among the other things a copied web page drags along", () => {
    // Copying an image from a page hands over the surrounding markup too.
    const shot = { name: "cat.png" };
    const items = [stringItem("text/html"), fileItem("image/png", shot)];
    assert.equal(pickPastedImage(items, false), shot);
  });

  it("lets text win when the caret is in a text box", () => {
    // Copying from a page usually means text/plain *and* an image. Stealing
    // that paste would make typing a name into the form impossible.
    const items = [stringItem("text/plain"), fileItem("image/png", { name: "x.png" })];
    assert.equal(pickPastedImage(items, true), null);
  });

  it("still takes an image pasted into a text box when there is no text with it", () => {
    const shot = { name: "shot.png" };
    assert.equal(pickPastedImage([fileItem("image/png", shot)], true), shot);
  });

  it("keeps looking when an item refuses to produce a file", () => {
    const real = { name: "real.jpg" };
    const items = [fileItem("image/png", null), fileItem("image/jpeg", real)];
    assert.equal(pickPastedImage(items, false), real);
  });

  it("returns null for an empty paste", () => {
    assert.equal(pickPastedImage([], false), null);
  });
});

describe("pickImageType", () => {
  it("prefers PNG whatever order the types come in", () => {
    assert.equal(pickImageType(["image/webp", "image/png"]), "image/png");
    assert.equal(pickImageType(["image/png", "image/webp"]), "image/png");
  });

  it("falls back to the first image type on offer", () => {
    assert.equal(pickImageType(["text/html", "image/jpeg", "image/gif"]), "image/jpeg");
  });

  it("returns null when the clipboard holds no image", () => {
    assert.equal(pickImageType(["text/plain", "text/html"]), null);
    assert.equal(pickImageType([]), null);
  });
});

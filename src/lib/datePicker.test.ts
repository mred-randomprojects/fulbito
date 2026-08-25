import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { openDatePicker, type PickerInput } from "./datePicker.js";

describe("openDatePicker", () => {
  it("opens the picker when the browser has one", () => {
    let opened = 0;
    const input: PickerInput = { showPicker: () => { opened += 1; } };
    assert.equal(openDatePicker(input), true);
    assert.equal(opened, 1);
  });

  it("says nothing happened on a browser without showPicker", () => {
    // Safari before 16. The field still takes typed digits, so the only wrong
    // move here would be throwing on the way past.
    assert.equal(openDatePicker({}), false);
  });

  it("survives the ref not being attached yet", () => {
    assert.equal(openDatePicker(null), false);
    assert.equal(openDatePicker(undefined), false);
  });

  it("swallows the throw Chrome uses for a call it will not honour", () => {
    // NotAllowedError when the call is not tied to a gesture, InvalidStateError
    // for a control that is not rendered. Taking the screen down mid-tap over
    // a picker that declined to open would be the worse outcome by a distance.
    const input: PickerInput = {
      showPicker: () => { throw new Error("NotAllowedError"); },
    };
    assert.equal(openDatePicker(input), false);
  });
});

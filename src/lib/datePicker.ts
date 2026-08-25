/**
 * Opening a date field's own picker.
 *
 * A native `<input type="date">` renders `25/08/2026`, which is ambiguous to
 * half the world, so the match date is drawn as Spanish text with the real
 * input laid invisibly over it. That trick costs one thing: Chrome only opens
 * the calendar when you hit its little indicator icon, and an invisible icon
 * is one nobody can hit. Clicking anywhere else lands on a segment of a field
 * that cannot be seen, which is indistinguishable from a broken control.
 *
 * So the field asks for the picker itself. `showPicker` is the one API that
 * does it, and it is typed structurally here — a single optional method —
 * rather than against `HTMLInputElement`, so this compiles under the DOM-free
 * test config and runs in plain Node.
 */

/** The slice of `HTMLInputElement` this needs. */
export interface PickerInput {
  showPicker?: () => void;
}

/**
 * Opens the browser's own picker for a date field. Returns whether it opened.
 *
 * Every way this can fail is a way the app must not fail with it. Browsers
 * older than `showPicker` (Safari before 16) simply do not have the method;
 * Chrome throws when the call is not tied to a real gesture, and again for a
 * control that is not being rendered. None of those are worth an unhandled
 * error: the field still takes typed digits, which is all it could ever do
 * before there was a picker to open.
 */
export function openDatePicker(input: PickerInput | null | undefined): boolean {
  if (input == null || typeof input.showPicker !== "function") return false;
  try {
    input.showPicker();
    return true;
  } catch {
    return false;
  }
}

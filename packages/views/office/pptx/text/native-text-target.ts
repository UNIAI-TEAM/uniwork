const NON_TEXT_INPUT_TYPES = new Set(["checkbox", "radio", "button", "range", "color", "file", "submit", "reset", "image"]);
const EDITABLE_SELECTOR = '[contenteditable=""],[contenteditable="true"],[contenteditable="plaintext-only"]';

/**
 * True when a keyboard event target has its own native text editing (and text undo/redo).
 * Exported for the section-level Ctrl+Z / Ctrl+Y handler in pptx-editor.tsx, which skips these.
 */
export function isNativeTextTarget(target: EventTarget | null): boolean {
  if (!target || typeof (target as Element).closest !== "function") return false;
  const element = target as Element;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag === "input") return !NON_TEXT_INPUT_TYPES.has(((element as HTMLInputElement).type || "text").toLowerCase());
  if (tag === "select") return false;
  return (element as HTMLElement).isContentEditable === true || element.closest(EDITABLE_SELECTOR) !== null;
}

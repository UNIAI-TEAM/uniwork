import { describe, expect, it } from "vitest";
import {
  PPTX_SHORTCUTS,
  matchPptxShortcut,
  pptxShortcutForAction,
  pptxShortcutKeys,
  pptxShortcutsForHelp,
} from "./pptx-shortcuts";

describe("PPTX_SHORTCUTS", () => {
  it("pins the chord -> action map the canvas dispatches", () => {
    const map = Object.fromEntries(PPTX_SHORTCUTS.map((binding) => [binding.id, binding.action]));
    expect(map).toMatchObject({
      undo: "undo",
      redo: "redo",
      "redo-shift": "redo",
      save: "save",
      find: "find",
      "edit-text": "edit-text",
      "select-all": "select-all",
      "delete-selection": "delete-selection",
      "next-slide": "next-slide",
      "previous-slide": "previous-slide",
      dismiss: "dismiss",
      "shortcuts-help": "shortcuts-help",
    });
  });

  it("uses unique ids and one primary help row per action", () => {
    const ids = PPTX_SHORTCUTS.map((binding) => binding.id);
    expect(new Set(ids).size).toBe(ids.length);
    const helpByAction = pptxShortcutsForHelp();
    const seen = new Set<string>();
    for (const binding of helpByAction) {
      expect(seen.has(binding.action)).toBe(false);
      seen.add(binding.action);
    }
  });

  it("gives every binding an office.pptx.shortcuts.* label key", () => {
    for (const binding of PPTX_SHORTCUTS) {
      expect(binding.labelKey.startsWith("office.pptx.shortcuts.")).toBe(true);
    }
  });
});

describe("matchPptxShortcut", () => {
  it("matches Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z, accepting Cmd too", () => {
    expect(matchPptxShortcut({ key: "z", ctrlKey: true })?.action).toBe("undo");
    expect(matchPptxShortcut({ key: "Z", metaKey: true })?.action).toBe("undo");
    expect(matchPptxShortcut({ key: "y", ctrlKey: true })?.action).toBe("redo");
    expect(matchPptxShortcut({ key: "z", ctrlKey: true, shiftKey: true })?.action).toBe("redo");
  });

  it("matches save, find and select all on the primary modifier", () => {
    expect(matchPptxShortcut({ key: "s", ctrlKey: true })?.action).toBe("save");
    expect(matchPptxShortcut({ key: "f", ctrlKey: true })?.action).toBe("find");
    expect(matchPptxShortcut({ key: "a", ctrlKey: true })?.action).toBe("select-all");
  });

  it("matches the unmodified keys: Delete, arrows, Escape and F2", () => {
    expect(matchPptxShortcut({ key: "Delete" })?.action).toBe("delete-selection");
    expect(matchPptxShortcut({ key: "Backspace" })?.action).toBe("delete-selection");
    expect(matchPptxShortcut({ key: "ArrowDown" })?.action).toBe("next-slide");
    expect(matchPptxShortcut({ key: "PageUp" })?.action).toBe("previous-slide");
    expect(matchPptxShortcut({ key: "Escape" })?.action).toBe("dismiss");
    expect(matchPptxShortcut({ key: "F2" })?.action).toBe("edit-text");
  });

  it("matches the help chords and returns null for an unbound key", () => {
    expect(matchPptxShortcut({ key: "?", shiftKey: true })?.action).toBe("shortcuts-help");
    expect(matchPptxShortcut({ key: "F1" })?.action).toBe("shortcuts-help");
    expect(matchPptxShortcut({ key: "q", ctrlKey: true })).toBeNull();
    expect(matchPptxShortcut({ key: "Delete", shiftKey: true })).toBeNull();
  });

  it("requires an exact modifier set", () => {
    // Ctrl+Shift+S is not save (Shift is extra).
    expect(matchPptxShortcut({ key: "s", ctrlKey: true, shiftKey: true })).toBeNull();
    // A bare "z" is not undo.
    expect(matchPptxShortcut({ key: "z" })).toBeNull();
  });
});

describe("pptxShortcutKeys", () => {
  it("labels the primary modifier per platform", () => {
    const undo = pptxShortcutForAction("undo");
    expect(undo).toBeDefined();
    if (!undo) return;
    expect(pptxShortcutKeys(undo, "windows")).toEqual(["Ctrl", "Z"]);
    expect(pptxShortcutKeys(undo, "macos")).toEqual(["Cmd", "Z"]);
    expect(pptxShortcutKeys(undo, "linux")).toEqual(["Ctrl", "Z"]);
  });
});
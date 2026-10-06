import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import {
  formatShortcut,
  SHORTCUT_ACTIONS,
  shortcutChordEquals,
  type ShortcutChord,
  type ShortcutPlatform,
} from "@uniwork/core/shortcuts";
import {
  DOCX_SHORTCUT_GROUPS,
  DOCX_SHORTCUTS,
  docxShortcutChords,
  resolveDocxShortcut,
  type DocxShortcut,
  type DocxShortcutId,
} from "./shortcut-map";

const PLATFORMS: readonly ShortcutPlatform[] = ["macos", "windows", "linux", "unknown"];

/** Mirrors GLOBAL_ACTIONS in packages/views/layout/global-shortcuts.tsx — the chords the
 * workspace shell dispatches while the DOCX editor is mounted. The page-scoped
 * findInTask/openThreadNav/send never listen there. */
const WORKSPACE_GLOBAL_ACTION_IDS = [
  "openSearch",
  "ai.askUni",
  "createTask",
  "goBack",
  "goForward",
  "goInbox",
  "goTasks",
  "goMyTasks",
  "goProjects",
  "goMeetings",
  "goChat",
  "goPeople",
  "goSettings",
] as const;

/** Collisions the wiring follow-up must settle (A9 review F3); any other collision fails. */
const DOCUMENTED_GLOBAL_COLLISIONS: Partial<Record<DocxShortcutId, string>> = {
  insertLink: "openSearch",
};

function workspaceGlobals() {
  return SHORTCUT_ACTIONS.filter((action) =>
    (WORKSPACE_GLOBAL_ACTION_IDS as readonly string[]).includes(action.id),
  );
}

function byId(id: DocxShortcutId): DocxShortcut {
  const found = DOCX_SHORTCUTS.find((shortcut) => shortcut.id === id);
  if (!found) throw new Error(`missing shortcut ${id}`);
  return found;
}

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((value, part) => {
    if (value === null || typeof value !== "object") return undefined;
    return (value as Record<string, unknown>)[part];
  }, dictionary);
}

/** Structural chord identity, independent of display formatting. */
function chordKey(chord: ShortcutChord): string {
  const { primary, control, meta, alt, shift } = chord.modifiers;
  return [chord.key, primary, control, meta, alt, shift].join("|");
}

function keyEvent(
  key: string,
  modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {},
  code?: string,
): KeyboardEvent {
  return { key, code, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers } as KeyboardEvent;
}

describe("DOCX shortcut map", () => {
  it("keeps ids unique and every entry chorded", () => {
    const ids = DOCX_SHORTCUTS.map((shortcut) => shortcut.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const shortcut of DOCX_SHORTCUTS) {
      expect(shortcut.chords.length, shortcut.id).toBeGreaterThan(0);
    }
  });

  it("groups every entry under a declared category and gives every category entries", () => {
    const groups = new Set(DOCX_SHORTCUT_GROUPS.map((group) => group.id));
    for (const shortcut of DOCX_SHORTCUTS) {
      expect(groups.has(shortcut.category), shortcut.id).toBe(true);
    }
    for (const group of DOCX_SHORTCUT_GROUPS) {
      expect(DOCX_SHORTCUTS.some((shortcut) => shortcut.category === group.id), group.id).toBe(true);
    }
  });

  it("binds each chord to one entry on every platform", () => {
    for (const platform of PLATFORMS) {
      const owners = new Map<string, string>();
      for (const shortcut of DOCX_SHORTCUTS) {
        for (const chord of docxShortcutChords(shortcut, platform)) {
          const rendered = formatShortcut(chord, platform);
          const key = chordKey(chord);
          const previous = owners.get(key);
          expect(previous, `${platform}: ${rendered} is bound to both ${previous} and ${shortcut.id}`).toBeUndefined();
          owners.set(key, shortcut.id);
        }
      }
    }
  });

  it("labels every entry and group in both locales", () => {
    for (const shortcut of DOCX_SHORTCUTS) {
      expect(typeof lookup(en, shortcut.labelKey), shortcut.labelKey).toBe("string");
      expect(typeof lookup(vi, shortcut.labelKey), shortcut.labelKey).toBe("string");
    }
    for (const group of DOCX_SHORTCUT_GROUPS) {
      expect(typeof lookup(en, group.labelKey), group.labelKey).toBe("string");
      expect(typeof lookup(vi, group.labelKey), group.labelKey).toBe("string");
    }
  });

  it("keeps label interpolation variables identical in both locales", () => {
    for (const shortcut of DOCX_SHORTCUTS) {
      for (const variable of Object.keys(shortcut.labelVars ?? {})) {
        const marker = `{{${variable}}}`;
        expect(lookup(en, shortcut.labelKey), `${shortcut.labelKey} en`).toContain(marker);
        expect(lookup(vi, shortcut.labelKey), `${shortcut.labelKey} vi`).toContain(marker);
      }
    }
  });

  it("spells redo and clear formatting per platform", () => {
    const redo = byId("redo");
    expect(docxShortcutChords(redo, "macos")).toHaveLength(1);
    expect(docxShortcutChords(redo, "macos")[0]!).toMatchObject({ key: "Z", modifiers: { primary: true, shift: true } });
    expect(docxShortcutChords(redo, "windows")).toHaveLength(2);

    const clear = byId("clearFormatting");
    expect(docxShortcutChords(clear, "macos")[0]!).toMatchObject({ key: "Space", modifiers: { control: true } });
    expect(docxShortcutChords(clear, "windows")[0]!).toMatchObject({ key: "Space", modifiers: { primary: true } });
  });

  it("marks only save, find and help as global", () => {
    expect(DOCX_SHORTCUTS.filter((shortcut) => shortcut.global).map((shortcut) => shortcut.id)).toEqual([
      "save",
      "find",
      "help",
    ]);
  });

  it("resolves events against the platform chord list", () => {
    expect(resolveDocxShortcut(keyEvent("b", { ctrlKey: true }), "windows")?.id).toBe("bold");
    // The core matcher normalizes "=", "-" and " " to Equals/Minus/Space.
    expect(resolveDocxShortcut(keyEvent("=", { ctrlKey: true }), "windows")?.id).toBe("zoomIn");
    expect(resolveDocxShortcut(keyEvent("-", { ctrlKey: true }), "windows")?.id).toBe("zoomOut");
    expect(resolveDocxShortcut(keyEvent(" ", { ctrlKey: true }), "windows")?.id).toBe("clearFormatting");
    // On a Mac the same command moves to literal Control, so ⌘Space stays free.
    expect(resolveDocxShortcut(keyEvent(" ", { ctrlKey: true }), "macos")?.id).toBe("clearFormatting");
    expect(resolveDocxShortcut(keyEvent(" ", { metaKey: true }), "macos")).toBeNull();
    expect(resolveDocxShortcut(keyEvent("s", { metaKey: true }), "macos")?.id).toBe("save");
    // A mac drops the Windows redo chord and keeps ⇧⌘Z.
    expect(resolveDocxShortcut(keyEvent("y", { metaKey: true }), "macos")).toBeNull();
    expect(resolveDocxShortcut(keyEvent("z", { metaKey: true, shiftKey: true }), "macos")?.id).toBe("redo");
    expect(resolveDocxShortcut(keyEvent("q", { ctrlKey: true }), "windows")).toBeNull();
  });

  it("resolves shifted digit and punctuation chords through the physical code", () => {
    // What a real US keydown delivers for the sheet's Ctrl+Shift+8 / Ctrl+Shift+7.
    expect(resolveDocxShortcut(keyEvent("*", { ctrlKey: true, shiftKey: true }, "Digit8"), "windows")?.id).toBe("bulletList");
    expect(resolveDocxShortcut(keyEvent("&", { ctrlKey: true, shiftKey: true }, "Digit7"), "windows")?.id).toBe("orderedList");
    // Grow/shrink advertise Ctrl+Shift+. / Ctrl+Shift+, — the key reports ">" / "<".
    expect(resolveDocxShortcut(keyEvent(">", { ctrlKey: true, shiftKey: true }, "Period"), "windows")?.id).toBe("growFont");
    expect(resolveDocxShortcut(keyEvent("<", { ctrlKey: true, shiftKey: true }, "Comma"), "windows")?.id).toBe("shrinkFont");
    // The same events on a Mac move to ⌘.
    expect(resolveDocxShortcut(keyEvent("*", { metaKey: true, shiftKey: true }, "Digit8"), "macos")?.id).toBe("bulletList");
  });

  it("resolves the shifted glyph even when the event carries no code", () => {
    expect(resolveDocxShortcut(keyEvent("*", { ctrlKey: true, shiftKey: true }), "windows")?.id).toBe("bulletList");
    expect(resolveDocxShortcut(keyEvent(">", { ctrlKey: true, shiftKey: true }), "windows")?.id).toBe("growFont");
  });

  it("keeps the physical fallback behind the chord's modifier requirements", () => {
    // Ctrl+8 is not the shifted chord, and Shift+8 alone lacks the primary modifier.
    expect(resolveDocxShortcut(keyEvent("*", { ctrlKey: true }, "Digit8"), "windows")).toBeNull();
    expect(resolveDocxShortcut(keyEvent("*", { shiftKey: true }, "Digit8"), "windows")).toBeNull();
  });

  it("marks every command that edits the document as write", () => {
    for (const id of ["undo", "redo", "cut", "paste", "bold", "growFont", "clearFormatting", "bulletList", "insertLink"] as const) {
      expect(byId(id).write, id).toBe(true);
    }
    for (const id of ["selectAll", "copy", "find", "help", "zoomIn"] as const) {
      expect(byId(id).write, id).toBeFalsy();
    }
  });

  it("declares no chord that collides with a workspace-shell global chord", () => {
    const globals = workspaceGlobals();
    for (const platform of PLATFORMS) {
      for (const shortcut of DOCX_SHORTCUTS) {
        for (const chord of docxShortcutChords(shortcut, platform)) {
          for (const action of globals) {
            if (!shortcutChordEquals(chord, action.defaultShortcut)) continue;
            expect(
              DOCUMENTED_GLOBAL_COLLISIONS[shortcut.id],
              `${shortcut.id} ${formatShortcut(chord, platform)} collides with global ${action.id}`,
            ).toBe(action.id);
          }
        }
      }
    }
  });

  it("keeps every documented global collision real", () => {
    const globals = workspaceGlobals();
    for (const [docxId, globalId] of Object.entries(DOCUMENTED_GLOBAL_COLLISIONS)) {
      const action = globals.find((candidate) => candidate.id === globalId);
      const collides = PLATFORMS.some((platform) =>
        docxShortcutChords(byId(docxId as DocxShortcutId), platform).some((chord) =>
          shortcutChordEquals(chord, action?.defaultShortcut ?? null),
        ),
      );
      expect(collides, `${docxId} no longer collides with ${globalId}`).toBe(true);
    }
  });
});

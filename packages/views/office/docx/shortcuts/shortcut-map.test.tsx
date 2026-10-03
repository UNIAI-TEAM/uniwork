import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import { formatShortcut, type ShortcutChord, type ShortcutPlatform } from "@uniwork/core/shortcuts";
import {
  DOCX_SHORTCUT_GROUPS,
  DOCX_SHORTCUTS,
  docxShortcutChords,
  resolveDocxShortcut,
  type DocxShortcut,
  type DocxShortcutId,
} from "./shortcut-map";

const PLATFORMS: readonly ShortcutPlatform[] = ["macos", "windows", "linux", "unknown"];

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
): KeyboardEvent {
  return { key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...modifiers } as KeyboardEvent;
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
});

import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { formatShortcut } from "@uniwork/core/shortcuts";
import {
  filterShortcutEntries,
  shortcutEntriesForCategory,
  XLSX_SHORTCUT_CATEGORIES,
  XLSX_SHORTCUTS,
  type XlsxShortcutEntry,
} from "./catalog";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function stringPaths(dictionary: unknown): string[] {
  const paths: string[] = [];
  const walk = (node: unknown, prefix: string) => {
    if (!node || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === "string") paths.push(path);
      else walk(value, path);
    }
  };
  walk(dictionary, "");
  return paths.sort();
}

describe("XLSX shortcuts catalog", () => {
  it("has unique ids and only known categories", () => {
    const ids = XLSX_SHORTCUTS.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of XLSX_SHORTCUTS) {
      expect(XLSX_SHORTCUT_CATEGORIES).toContain(entry.category);
    }
  });

  it("gives every entry at least one chord and labels in both locales", () => {
    for (const entry of XLSX_SHORTCUTS) {
      expect(entry.chords.length, entry.id).toBeGreaterThan(0);
      for (const locale of [en, viLocale]) {
        expect(typeof lookup(locale, entry.labelKey), entry.labelKey).toBe("string");
      }
    }
  });

  it("covers every category with at least one entry", () => {
    for (const category of XLSX_SHORTCUT_CATEGORIES) {
      expect(shortcutEntriesForCategory(XLSX_SHORTCUTS, category).length, category).toBeGreaterThan(0);
    }
  });

  it("keeps the office.xlsx.shortcuts subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.shortcuts"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});

describe("shortcut platform rendering", () => {
  const byId = (id: string): XlsxShortcutEntry => {
    const entry = XLSX_SHORTCUTS.find((candidate) => candidate.id === id);
    if (!entry) throw new Error(`missing shortcut ${id}`);
    return entry;
  };

  it("renders the primary modifier as Ctrl on non-mac and Command on mac", () => {
    const save = byId("save").chords[0]!;
    expect(formatShortcut(save, "windows")).toBe("Ctrl+S");
    expect(formatShortcut(save, "linux")).toBe("Ctrl+S");
    expect(formatShortcut(save, "macos")).toBe("⌘S");
  });

  it("renders the redo alternative chords with the right modifiers", () => {
    const [first, second] = byId("redo").chords;
    expect(formatShortcut(first!, "windows")).toBe("Ctrl+Y");
    expect(formatShortcut(second!, "windows")).toBe("Ctrl+Shift+Z");
    expect(formatShortcut(second!, "macos")).toBe("⌘⇧Z");
  });

  it("renders a bare navigation key with no modifier", () => {
    expect(formatShortcut(byId("moveUp").chords[0]!, "windows")).toBe("↑");
    expect(formatShortcut(byId("zoomIn").chords[0]!, "macos")).toBe("⌘=");
  });
});

describe("filterShortcutEntries", () => {
  const labelOf = (entry: XlsxShortcutEntry) => entry.id;

  it("returns everything for an empty query", () => {
    expect(filterShortcutEntries(XLSX_SHORTCUTS, "  ", labelOf)).toEqual(XLSX_SHORTCUTS);
  });

  it("filters case-insensitively by the resolved label", () => {
    const result = filterShortcutEntries(XLSX_SHORTCUTS, "PASTE", labelOf);
    expect(result.map((entry) => entry.id)).toEqual(["paste"]);
  });

  it("returns nothing when the query matches no label", () => {
    expect(filterShortcutEntries(XLSX_SHORTCUTS, "zzzz", labelOf)).toEqual([]);
  });
});
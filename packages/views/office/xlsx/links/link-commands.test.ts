import { describe, expect, it } from "vitest";
import enLocale from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_HYPERLINK_COMMAND, XLSX_NOTE_COMMAND, parseA1Address } from "./link-commands";

/** Every key links-group.tsx + the toolbar registry read through t(). */
const LINK_KEYS = [
  "office.xlsx.links.insert",
  "office.xlsx.links.note",
  "office.xlsx.links.groups.insert",
  "office.xlsx.links.dialog.linkTitle",
  "office.xlsx.links.dialog.noteTitle",
  "office.xlsx.links.dialog.target",
  "office.xlsx.links.dialog.targetPlaceholder",
  "office.xlsx.links.dialog.hint",
  "office.xlsx.links.dialog.noteText",
  "office.xlsx.links.dialog.notePlaceholder",
  "office.xlsx.links.dialog.apply",
  "office.xlsx.links.dialog.cancel",
  "office.xlsx.editor.appHyperlinkTargetInvalid",
] as const;

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

describe("xlsx link/note locale keys", () => {
  it("ships every B6 key in both locales (no raw-key rendering)", () => {
    for (const key of LINK_KEYS) {
      expect(typeof lookup(enLocale, key), key).toBe("string");
      expect(typeof lookup(viLocale, key), key).toBe("string");
    }
  });
});

describe("the xlsx link/note command vocabulary", () => {
  it("names the UniWork hyperlink command and the pinned note command", () => {
    expect(XLSX_HYPERLINK_COMMAND).toBe("uniwork.command.set-hyperlink");
    expect(XLSX_NOTE_COMMAND).toBe("sheet.command.update-note");
  });
});

describe("parseA1Address", () => {
  it("parses A1 spellings into 0-based row/column", () => {
    expect(parseA1Address("A1")).toEqual({ row: 0, column: 0 });
    expect(parseA1Address("B5")).toEqual({ row: 4, column: 1 });
    expect(parseA1Address("$AA$1")).toEqual({ row: 0, column: 26 });
    expect(parseA1Address(" XFD1048576 ")).toEqual({ row: 1_048_575, column: 16_383 });
  });

  it("rejects malformed and out-of-grid addresses", () => {
    for (const address of ["", "1A", "A0", "A", "1", "XFE1", "A1048577", "$", "A1:B2"]) {
      expect(parseA1Address(address), address).toBeNull();
    }
  });
});

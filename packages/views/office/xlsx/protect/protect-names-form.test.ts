import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "../toolbar/registry";
import { buildDefinedNames, definedNameValid, emptyNameRow } from "./protect-names-form";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

describe("xlsx protect + name manager", () => {
  it("accepts Excel-grammar names and refuses cell refs and reserved names", () => {
    expect(definedNameValid("Sales")).toBe(true);
    expect(definedNameValid("_local")).toBe(true);
    expect(definedNameValid("A1")).toBe(false);
    expect(definedNameValid("R1C1")).toBe(false);
    expect(definedNameValid("TRUE")).toBe(false);
    expect(definedNameValid("_xlnm.Print_Area")).toBe(false);
    expect(definedNameValid("1bad")).toBe(false);
  });

  it("maps rows to entries, ignoring blank rows and refusing bad shapes", () => {
    const built = buildDefinedNames([
      { name: "Sales", formula: "Sheet1!$A$1:$B$2", sheetIndex: "" },
      emptyNameRow(),
    ]);
    expect(built).toEqual({ ok: true, names: [{ name: "Sales", formula: "Sheet1!$A$1:$B$2" }] });
    expect(buildDefinedNames([{ name: "Sales", formula: "", sheetIndex: "" }])).toEqual({ ok: false, error: "formula" });
    expect(buildDefinedNames([{ name: "A1", formula: "Sheet1!$A$1", sheetIndex: "" }])).toEqual({ ok: false, error: "name" });
    expect(buildDefinedNames([{ name: "N", formula: "A1", sheetIndex: "x" }])).toEqual({ ok: false, error: "sheetIndex" });
    expect(buildDefinedNames([
      { name: "N", formula: "A1", sheetIndex: "" },
      { name: "N", formula: "A2", sheetIndex: "" },
    ])).toEqual({ ok: false, error: "duplicate" });
  });

  it("registers the Review-tab group with labels in both locales", () => {
    const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === "protect");
    if (!group) throw new Error("missing protect group");
    expect(group.tab).toBe("review");
    for (const locale of [en, vi]) {
      expect(typeof lookup(locale, group.labelKey)).toBe("string");
      expect(typeof lookup(locale, "office.xlsx.protect.dialog.title")).toBe("string");
    }
  });
});

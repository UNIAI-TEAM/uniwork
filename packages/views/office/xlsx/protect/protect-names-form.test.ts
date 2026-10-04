import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "../toolbar/registry";
import { buildDefinedNames, definedNameValid, emptyNameRow, seedDefinedNames } from "./protect-names-form";

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

  it("seeds rows from the file's own names and preserves the unmodelable ones", () => {
    const seed = seedDefinedNames([
      { name: "Sales", formula: "Sheet1!$A$1:$B$2" },
      { name: "Scoped", formula: "Sheet2!$A$1", sheetIndex: 1 },
      { name: "Hidden", formula: "Sheet1!$A$1", hidden: true },
      { name: "OutOfRange", formula: "Sheet1!$A$1", sheetIndex: 9 },
      { name: "_xlnm.Print_Area", formula: "Sheet1!$A$1:$B$2" },
      { name: "A1", formula: "Sheet1!$A$1" },
    ], 2);
    expect(seed.rows).toEqual([
      { name: "Sales", formula: "Sheet1!$A$1:$B$2", sheetIndex: "" },
      { name: "Scoped", formula: "Sheet2!$A$1", sheetIndex: "1" },
    ]);
    // Hidden and out-of-range-scope names ride preserveNames; the _xlnm
    // built-in is kept by the gateway and is not listed. A cell-ref name (A1)
    // is refused by the grammar and also preserved.
    expect(seed.preserveNames).toEqual(["Hidden", "OutOfRange", "A1"]);
  });

  it("groups a name by name: one unmodelable entry preserves the whole name (F1)", () => {
    // The gateway contract is name-keyed, so a name carrying both a modelable
    // and an unmodelable entry must never be split across rows and preserveNames.
    const seed = seedDefinedNames([
      { name: "Split", formula: "Sheet1!$A$1" },
      { name: "Split", formula: "Sheet1!$A$1", hidden: true },
      { name: "Dup", formula: "Sheet1!$A$1" },
      { name: "Dup", formula: "Sheet1!$A$1" },
    ], 2);
    expect(seed.rows).toEqual([]);
    expect(seed.preserveNames).toEqual(["Split", "Dup"]);
    // The same name at two different scopes is representable as two rows.
    const scoped = seedDefinedNames([
      { name: "Both", formula: "Sheet1!$A$1" },
      { name: "Both", formula: "Sheet2!$A$1", sheetIndex: 1 },
    ], 2);
    expect(scoped.rows).toEqual([
      { name: "Both", formula: "Sheet1!$A$1", sheetIndex: "" },
      { name: "Both", formula: "Sheet2!$A$1", sheetIndex: "1" },
    ]);
    expect(scoped.preserveNames).toEqual([]);
  });

  it("refuses a row named like an invisible preserved name (F1)", () => {
    expect(buildDefinedNames([{ name: "Hidden", formula: "A1", sheetIndex: "" }], 2, ["Hidden"]))
      .toEqual({ ok: false, error: "collision" });
    expect(buildDefinedNames([{ name: "Other", formula: "A1", sheetIndex: "" }], 2, ["Hidden"]))
      .toEqual({ ok: true, names: [{ name: "Other", formula: "A1" }] });
  });

  it("bounds the sheet scope against the live sheet count (F5)", () => {
    expect(buildDefinedNames([{ name: "N", formula: "A1", sheetIndex: "1" }], 2)).toEqual({
      ok: true, names: [{ name: "N", formula: "A1", sheetIndex: 1 }],
    });
    expect(buildDefinedNames([{ name: "N", formula: "A1", sheetIndex: "2" }], 2)).toEqual({ ok: false, error: "sheetIndex" });
    // Without a known sheet count the sanity ceiling still applies.
    expect(buildDefinedNames([{ name: "N", formula: "A1", sheetIndex: "2" }])).toEqual({
      ok: true, names: [{ name: "N", formula: "A1", sheetIndex: 2 }],
    });
  });

  it("registers the Review-tab group with labels in both locales", () => {
    const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === "protect");
    if (!group) throw new Error("missing protect group");
    expect(group.tab).toBe("review");
    for (const locale of [en, vi]) {
      expect(typeof lookup(locale, group.labelKey)).toBe("string");
      expect(typeof lookup(locale, "office.xlsx.protect.dialog.title")).toBe("string");
      expect(typeof lookup(locale, "office.xlsx.protect.dialog.workbookScope")).toBe("string");
      expect(typeof lookup(locale, "office.xlsx.protect.dialog.invalid.collision")).toBe("string");
    }
  });
});

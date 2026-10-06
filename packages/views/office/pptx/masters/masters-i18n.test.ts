import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import { PPTX_MASTERS_I18N, mastersPanelDictionary } from "./masters-i18n";

describe("PPTX_MASTERS_I18N", () => {
  it("is merged verbatim into the shared locale files (en and vi)", () => {
    expect((en as { office: { pptx: { masters: unknown } } }).office.pptx.masters).toEqual((mastersPanelDictionary("en") as { office: { pptx: { masters: unknown } } }).office.pptx.masters);
    expect((vi as { office: { pptx: { masters: unknown } } }).office.pptx.masters).toEqual((mastersPanelDictionary("vi") as { office: { pptx: { masters: unknown } } }).office.pptx.masters);
  });

  it("keeps every key under office.pptx.masters.* with en and vi copy", () => {
    for (const [key, entry] of Object.entries(PPTX_MASTERS_I18N)) {
      expect(key).toMatch(/^office\.pptx\.masters\.[a-z0-9_]+$/);
      expect(entry.en.trim().length, key).toBeGreaterThan(0);
      expect(entry.vi.trim().length, key).toBeGreaterThan(0);
    }
  });

  it("carries the same {{vars}} in both locales", () => {
    const vars = (v: string) => (v.match(/\{\{\s*\w+\s*\}\}/g) ?? []).map((m) => m.replace(/\s+/g, "")).sort();
    for (const [key, entry] of Object.entries(PPTX_MASTERS_I18N)) expect(vars(entry.vi), key).toEqual(vars(entry.en));
  });

  it("has no lossy-channel corruption in vi", () => {
    const bad = Object.entries(PPTX_MASTERS_I18N)
      .filter(([, e]) => /[A-Za-z]\?|\?[A-Za-z]/.test(e.vi) || e.vi.includes("�"))
      .map(([k]) => k);
    expect(bad).toEqual([]);
  });

  it("nests into the shared locale shape with the same leaf count", () => {
    const leaves = (node: Record<string, unknown>): number =>
      Object.values(node).reduce<number>(
        (n, v) => n + (typeof v === "object" && v !== null ? leaves(v as Record<string, unknown>) : 1),
        0,
      );
    const en = mastersPanelDictionary("en") as { office: { pptx: { masters: { title: string } } } };
    expect(en.office.pptx.masters.title).toBe("Slide master");
    expect(leaves(mastersPanelDictionary("vi"))).toBe(Object.keys(PPTX_MASTERS_I18N).length);
  });

  it("defines every static key the components call through t()", () => {
    const keys = new Set<string>(["x", "y", "w", "h"]);
    for (const file of ["masters-panel.tsx", "masters-inspector.tsx"]) {
      const source = readFileSync(new URL("./" + file, import.meta.url), "utf8");
      for (const match of source.matchAll(/t\("masters\.([a-z_]+)"/g)) keys.add(match[1]!);
    }
    const missing = [...keys].filter((key) => !("office.pptx.masters." + key in PPTX_MASTERS_I18N));
    expect(missing).toEqual([]);
  });
});

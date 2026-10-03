import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "./registry";

const A1_GROUPS = [
  { id: "font", order: 50 },
  { id: "alignment", order: 60 },
  { id: "borders", order: 70 },
] as const;

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

describe("xlsx toolbar registry", () => {
  it("keeps every group id unique", () => {
    const ids = XLSX_TOOLBAR_GROUPS.map((group) => group.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("registers the Home formatting groups with labels in both locales", () => {
    for (const expected of A1_GROUPS) {
      const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === expected.id);
      if (!group) throw new Error(`missing registry group ${expected.id}`);
      expect(group.tab).toBe("home");
      expect(group.order).toBe(expected.order);
      for (const locale of [en, vi]) {
        expect(typeof lookup(locale, group.labelKey), `${expected.id} ${group.labelKey}`).toBe("string");
      }
    }
  });

  it("keeps the A1 group subtrees in vi/en key parity", () => {
    for (const id of A1_GROUPS.map((group) => group.id)) {
      const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, `office.xlsx.toolbar.groups.${id}`));
      expect(subtree(vi).length).toBeGreaterThan(0);
      expect(subtree(vi)).toEqual(subtree(en));
    }
  });
});

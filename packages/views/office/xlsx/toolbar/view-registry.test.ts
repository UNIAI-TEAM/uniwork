import { describe, expect, it } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import vi from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "./registry";

const VIEW_GROUPS = [
  { id: "view-zoom", order: 10 },
  { id: "view-display", order: 20 },
  { id: "view-goto", order: 30 },
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

describe("xlsx view toolbar registry", () => {
  it("registers the three View groups in order with labels in both locales", () => {
    for (const expected of VIEW_GROUPS) {
      const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === expected.id);
      if (!group) throw new Error(`missing registry group ${expected.id}`);
      expect(group.tab).toBe("view");
      expect(group.order).toBe(expected.order);
      for (const locale of [en, vi]) {
        expect(typeof lookup(locale, group.labelKey), `${expected.id} ${group.labelKey}`).toBe("string");
      }
    }
  });

  it("keeps the view group subtrees in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.toolbar.groups.view"));
    expect(subtree(vi).length).toBeGreaterThan(0);
    expect(subtree(vi)).toEqual(subtree(en));
  });

  it("keeps the office.xlsx.view subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.view"));
    expect(subtree(vi).length).toBeGreaterThan(0);
    expect(subtree(vi)).toEqual(subtree(en));
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "../toolbar/registry";
import type { XlsxToolbarGroupProps } from "../toolbar/types";
import { XlsxFindGroup } from "./find-group";

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

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    formatState: null,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    onOpenFind: vi.fn(),
    ...overrides,
  };
}

describe("XlsxFindGroup", () => {
  it("opens the editor-owned find panel", () => {
    const onOpenFind = vi.fn();
    render(<XlsxFindGroup {...groupProps({ onOpenFind })} />);
    const button = screen.getByTestId("xlsx-find-open");
    expect(button).toHaveAccessibleName(lookup(viLocale, "office.xlsx.toolbar.groups.find.label"));
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    expect(onOpenFind).toHaveBeenCalledOnce();
  });

  it("stays in the tab order and inert without a mounted grid or a handler", () => {
    for (const overrides of [{ commands: undefined }, { onOpenFind: undefined }, { readOnly: true }] as Partial<XlsxToolbarGroupProps>[]) {
      const onOpenFind = vi.fn();
      const view = render(<XlsxFindGroup {...groupProps({ onOpenFind, ...overrides })} />);
      const button = screen.getByTestId("xlsx-find-open");
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      fireEvent.click(button);
      expect(onOpenFind).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});

describe("xlsx find registry entry", () => {
  it("registers the group on the Home tab with a label in both locales", () => {
    const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === "find");
    if (!group) throw new Error("missing registry group find");
    expect(group.tab).toBe("home");
    expect(group.order).toBe(95);
    expect(group.labelKey).toBe("office.xlsx.toolbar.groups.find.label");
    for (const locale of [en, viLocale]) {
      expect(typeof lookup(locale, group.labelKey)).toBe("string");
    }
  });

  it("keeps the find group subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.toolbar.groups.find"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});

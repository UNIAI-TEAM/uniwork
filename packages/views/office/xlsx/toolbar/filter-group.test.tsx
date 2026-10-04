import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "./registry";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxFilterGroup } from "./filter-group";

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
    onOpenAdvancedFilter: vi.fn(),
    ...overrides,
  };
}

describe("XlsxFilterGroup", () => {
  it("runs the pinned filter commands through the port", () => {
    const execute = vi.fn(() => true);
    render(<XlsxFilterGroup {...groupProps({ commands: { execute } })} />);
    expect(screen.getByTestId("xlsx-filter-toggle")).toHaveAccessibleName(lookup(viLocale, "office.xlsx.filter.toggle"));
    fireEvent.click(screen.getByTestId("xlsx-filter-toggle"));
    expect(execute).toHaveBeenCalledWith("sheet.command.smart-toggle-filter");
    fireEvent.click(screen.getByTestId("xlsx-filter-clear"));
    expect(execute).toHaveBeenCalledWith("sheet.command.clear-filter-criteria");
  });

  it("opens the editor-owned advanced filter dialog", () => {
    const onOpenAdvancedFilter = vi.fn();
    render(<XlsxFilterGroup {...groupProps({ onOpenAdvancedFilter })} />);
    const button = screen.getByTestId("xlsx-filter-advanced");
    expect(button).toHaveAttribute("aria-haspopup", "dialog");
    fireEvent.click(button);
    expect(onOpenAdvancedFilter).toHaveBeenCalledOnce();
  });

  it("stays in the tab order and inert without a mounted grid, a handler or edit rights", () => {
    // The toggle and clear are inert on the commands port / edit rights; the
    // advanced entry alone also needs the editor's dialog handler. Each control
    // is asserted against its own gate and stays focusable (never `disabled`).
    for (const [overrides, disabledIds] of [
      [{ commands: undefined }, ["xlsx-filter-toggle", "xlsx-filter-clear", "xlsx-filter-advanced"]],
      [{ onOpenAdvancedFilter: undefined }, ["xlsx-filter-advanced"]],
      [{ readOnly: true }, ["xlsx-filter-toggle", "xlsx-filter-clear", "xlsx-filter-advanced"]],
    ] as [Partial<XlsxToolbarGroupProps>, string[]][]) {
      const onOpenAdvancedFilter = vi.fn();
      const view = render(<XlsxFilterGroup {...groupProps({ onOpenAdvancedFilter, ...overrides })} />);
      for (const testId of ["xlsx-filter-toggle", "xlsx-filter-clear", "xlsx-filter-advanced"]) {
        const button = screen.getByTestId(testId);
        expect(button).not.toBeDisabled();
        if (disabledIds.includes(testId)) {
          expect(button).toHaveAttribute("aria-disabled", "true");
          fireEvent.click(button);
        } else {
          expect(button).not.toHaveAttribute("aria-disabled");
        }
      }
      expect(onOpenAdvancedFilter).not.toHaveBeenCalled();
      view.unmount();
    }
  });
});

describe("xlsx filter registry entry", () => {
  it("registers the group on the Data tab with a label in both locales", () => {
    const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === "filter");
    if (!group) throw new Error("missing registry group filter");
    expect(group.tab).toBe("data");
    expect(group.labelKey).toBe("office.xlsx.filter.groups.data");
    for (const locale of [en, viLocale]) {
      expect(typeof lookup(locale, group.labelKey)).toBe("string");
    }
  });

  it("keeps the filter subtree in vi/en key parity", () => {
    const subtree = (dictionary: unknown) => stringPaths(lookup(dictionary, "office.xlsx.filter"));
    expect(subtree(viLocale).length).toBeGreaterThan(0);
    expect(subtree(viLocale)).toEqual(subtree(en));
  });
});

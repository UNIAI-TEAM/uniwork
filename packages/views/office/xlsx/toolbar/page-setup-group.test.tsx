import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "./registry";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxPageSetupGroup } from "./page-setup-group";

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
    onOpenPageSetup: vi.fn(),
    onPrint: vi.fn(),
    onExportCsv: vi.fn(),
    ...overrides,
  };
}

describe("XlsxPageSetupGroup", () => {
  it("opens the page-setup dialog and runs the print/export host actions", () => {
    const onOpenPageSetup = vi.fn();
    const onPrint = vi.fn();
    const onExportCsv = vi.fn();
    render(<XlsxPageSetupGroup {...groupProps({ onOpenPageSetup, onPrint, onExportCsv })} />);
    expect(screen.getByTestId("xlsx-page-setup-open")).toHaveAccessibleName(lookup(viLocale, "office.xlsx.pageSetup.open"));
    expect(screen.getByTestId("xlsx-print")).toHaveAccessibleName(lookup(viLocale, "office.common.print"));
    fireEvent.click(screen.getByTestId("xlsx-page-setup-open"));
    fireEvent.click(screen.getByTestId("xlsx-print"));
    fireEvent.click(screen.getByTestId("xlsx-export-csv"));
    expect(onOpenPageSetup).toHaveBeenCalledOnce();
    expect(onPrint).toHaveBeenCalledOnce();
    expect(onExportCsv).toHaveBeenCalledOnce();
    expect(screen.getByTestId("xlsx-print")).not.toHaveAttribute("aria-busy");
  });

  it("shows Print busy and inert, still focusable, while a run is pending (R1)", () => {
    const onPrint = vi.fn();
    render(<XlsxPageSetupGroup {...groupProps({ onPrint, printBusy: true })} />);
    const button = screen.getByTestId("xlsx-print");
    expect(button).toHaveAttribute("aria-busy", "true");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).not.toBeDisabled();
    fireEvent.click(button);
    expect(onPrint).not.toHaveBeenCalled();
  });

  it("stays in the tab order and inert when the host wires no handlers, and offers no Print without a port", () => {
    // No handlers at all: Page Setup and CSV are inert (and still in the tab
    // order); Print is not rendered (UNI-952: a host that cannot print).
    const view = render(
      <XlsxPageSetupGroup {...groupProps({ onOpenPageSetup: undefined, onPrint: undefined, onExportCsv: undefined })} />,
    );
    expect(screen.queryByTestId("xlsx-print")).toBeNull();
    for (const testId of ["xlsx-page-setup-open", "xlsx-export-csv"]) {
      const button = screen.getByTestId(testId);
      expect(button).toHaveAttribute("aria-disabled", "true");
      expect(button).not.toBeDisabled();
      fireEvent.click(button);
    }
    view.unmount();
  });

  it("gates Page Setup on read-only but keeps Print and CSV usable (handler presence only)", () => {
    // Print and Export CSV are intentionally gated on handler presence alone:
    // printing and exporting a read-only workbook are safe. Page Setup edits
    // the file, so read-only disables it.
    const onOpenPageSetup = vi.fn();
    const onPrint = vi.fn();
    const onExportCsv = vi.fn();
    render(<XlsxPageSetupGroup {...groupProps({ readOnly: true, onOpenPageSetup, onPrint, onExportCsv })} />);

    const pageSetup = screen.getByTestId("xlsx-page-setup-open");
    expect(pageSetup).toHaveAttribute("aria-disabled", "true");
    expect(pageSetup).not.toBeDisabled();
    fireEvent.click(pageSetup);
    expect(onOpenPageSetup).not.toHaveBeenCalled();

    for (const testId of ["xlsx-print", "xlsx-export-csv"]) {
      const button = screen.getByTestId(testId);
      expect(button).not.toHaveAttribute("aria-disabled");
      expect(button).not.toBeDisabled();
      fireEvent.click(button);
    }
    expect(onPrint).toHaveBeenCalledOnce();
    expect(onExportCsv).toHaveBeenCalledOnce();
  });
});

describe("xlsx page-setup registry entry", () => {
  it("registers the group on the View tab with a label in both locales", () => {
    const group = XLSX_TOOLBAR_GROUPS.find((candidate) => candidate.id === "page-setup");
    if (!group) throw new Error("missing registry group page-setup");
    expect(group.tab).toBe("view");
    expect(group.labelKey).toBe("office.xlsx.pageSetup.groups.view");
    for (const locale of [en, viLocale]) {
      expect(typeof lookup(locale, group.labelKey)).toBe("string");
    }
  });

  it("keeps the page-setup and export subtrees in vi/en key parity", () => {
    for (const subtree of ["office.xlsx.pageSetup", "office.xlsx.export", "office.xlsx.print"]) {
      const paths = (dictionary: unknown) => stringPaths(lookup(dictionary, subtree));
      expect(paths(viLocale).length).toBeGreaterThan(0);
      expect(paths(viLocale)).toEqual(paths(en));
    }
  });
});

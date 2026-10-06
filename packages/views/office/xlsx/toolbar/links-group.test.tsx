import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XLSX_TOOLBAR_GROUPS } from "./registry";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxLinksGroup } from "./links-group";
import { parseA1Address } from "../links/link-commands";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function groupProps(overrides: Partial<XlsxToolbarGroupProps> = {}): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "B2" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute: vi.fn(() => true) },
    formatState: null,
    unitId: "file-sha",
    resolveSheetId: () => "sheet-1",
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
}

describe("parseA1Address", () => {
  it("parses A1 spellings and rejects malformed/out-of-grid addresses", () => {
    expect(parseA1Address("B5")).toEqual({ row: 4, column: 1 });
    expect(parseA1Address("$AA$1")).toEqual({ row: 0, column: 26 });
    expect(parseA1Address("A1")).toEqual({ row: 0, column: 0 });
    expect(parseA1Address("1A")).toBeNull();
    expect(parseA1Address("XFE1")).toBeNull();
    expect(parseA1Address("")).toBeNull();
  });
});

describe("XlsxLinksGroup", () => {
  it("is registered on the insert tab", () => {
    expect(XLSX_TOOLBAR_GROUPS.find((group) => group.id === "links")?.tab).toBe("insert");
  });

  it("opens the link dialog and executes the hyperlink command for the active cell", () => {
    const execute = vi.fn(() => true);
    render(<XlsxLinksGroup {...groupProps({ commands: { execute } })} />);
    expect(screen.getByTestId("xlsx-link-insert")).toHaveAccessibleName(lookup(viLocale, "office.xlsx.links.insert"));
    fireEvent.click(screen.getByTestId("xlsx-link-insert"));
    fireEvent.change(screen.getByLabelText(lookup(viLocale, "office.xlsx.links.dialog.target") as string), { target: { value: "https://example.com" } });
    fireEvent.click(screen.getByText(lookup(viLocale, "office.xlsx.links.dialog.apply") as string));
    expect(execute).toHaveBeenCalledWith("uniwork.command.set-hyperlink", { unitId: "file-sha", subUnitId: "sheet-1", address: "B2", target: "https://example.com" });
  });

  it("executes the pinned note command with the active cell and note text", () => {
    const execute = vi.fn(() => true);
    render(<XlsxLinksGroup {...groupProps({ commands: { execute } })} />);
    fireEvent.click(screen.getByTestId("xlsx-note-insert"));
    fireEvent.change(screen.getByLabelText(lookup(viLocale, "office.xlsx.links.dialog.noteText") as string), { target: { value: "Xem lai" } });
    fireEvent.click(screen.getByText(lookup(viLocale, "office.xlsx.links.dialog.apply") as string));
    expect(execute).toHaveBeenCalledWith("sheet.command.update-note", { unitId: "file-sha", subUnitId: "sheet-1", row: 1, col: 1, note: { id: "1:1", note: "Xem lai" } });
  });

  it("labels the note command with visible text (design review X2)", () => {
    render(<XlsxLinksGroup {...groupProps()} />);
    const note = screen.getByTestId("xlsx-note-insert");
    expect(note).toHaveTextContent(lookup(viLocale, "office.xlsx.links.noteShort") as string);
    // Label in name: the accessible name is the visible text; the tooltip says more.
    expect(note).toHaveAccessibleName(lookup(viLocale, "office.xlsx.links.noteShort") as string);
    expect(note).toHaveAttribute("title", lookup(viLocale, "office.xlsx.links.note") as string);
  });

  it("stays inert under read-only", () => {
    const execute = vi.fn(() => true);
    render(<XlsxLinksGroup {...groupProps({ readOnly: true, commands: { execute } })} />);
    expect(screen.getByTestId("xlsx-link-insert")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(screen.getByTestId("xlsx-link-insert"));
    expect(execute).not.toHaveBeenCalled();
  });
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeDocumentActiveProvider } from "../common/document-active";
import { fireCommand } from "./fire-command";
import { appliedFormatKey, readAppliedPattern, recordAppliedFormat } from "./number-format/applied-format";
import { XLSX_FORMAT_PAINTER_OFF, XLSX_FORMAT_PAINTER_OPERATION, XlsxFormatPainterButton } from "./toolbar/clear/format-painter";
import type { XlsxToolbarCommands } from "./toolbar/types";
import type { XlsxToolbarGroupProps } from "./toolbar/types";
import { XlsxFrameNotices } from "./xlsx-frame-notices";

// UNI-957: two workbooks mounted side by side (the desktop tab strip keeps
// inactive tabs mounted) must not act on each other.

const CANCEL = [XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_OFF }];

function painterProps(commands: XlsxToolbarCommands): XlsxToolbarGroupProps {
  return {
    readOnly: false,
    selection: { sheet: "Data", address: "A1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    formatState: null,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    commands,
  };
}

describe("xlsx tab isolation", () => {
  afterEach(() => vi.restoreAllMocks());

  it("Escape disarms the format painter of the active document only", async () => {
    const executeA = vi.fn(() => true);
    const executeB = vi.fn(() => true);
    render(
      <>
        <div data-testid="doc-a"><XlsxFormatPainterButton {...painterProps({ execute: executeA })} /></div>
        <OfficeDocumentActiveProvider active={false}>
          <div data-testid="doc-b"><XlsxFormatPainterButton {...painterProps({ execute: executeB })} /></div>
        </OfficeDocumentActiveProvider>
      </>,
    );
    const buttonA = within(screen.getByTestId("doc-a")).getByTestId("xlsx-format-painter");
    const buttonB = within(screen.getByTestId("doc-b")).getByTestId("xlsx-format-painter");
    fireEvent.click(buttonA);
    fireEvent.click(buttonB);
    await waitFor(() => expect(buttonA).toHaveAttribute("aria-pressed", "true"));
    await waitFor(() => expect(buttonB).toHaveAttribute("aria-pressed", "true"));
    executeA.mockClear();
    executeB.mockClear();

    fireEvent.keyDown(window, { key: "Escape" });

    expect(executeA).toHaveBeenCalledWith(...CANCEL);
    expect(executeB).not.toHaveBeenCalled();
    await waitFor(() => expect(buttonA).toHaveAttribute("aria-pressed", "false"));
    expect(buttonB).toHaveAttribute("aria-pressed", "true");
  });

  it("a refused structural command raises the notice of its own document only", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const commandsA = { execute: vi.fn(() => Promise.resolve(false)) } as XlsxToolbarCommands;
    const commandsB = { execute: vi.fn(() => Promise.resolve(true)) } as XlsxToolbarCommands;
    const notices = (commands: XlsxToolbarCommands, testId: string) => (
      <div data-testid={testId}>
        <XlsxFrameNotices recalcProgress={null} recalcError={null} editFailed={false} onCancelRecalculate={() => undefined} commands={commands} />
      </div>
    );
    render(
      <>
        {notices(commandsA, "doc-a")}
        <OfficeDocumentActiveProvider active={false}>{notices(commandsB, "doc-b")}</OfficeDocumentActiveProvider>
      </>,
    );
    await act(async () => {
      fireCommand(commandsA, "sheet.command.insert-multi-rows-after", { value: 1 });
    });
    expect(within(screen.getByTestId("doc-a")).getByTestId("xlsx-command-refused")).toBeTruthy();
    expect(within(screen.getByTestId("doc-b")).queryByTestId("xlsx-command-refused")).toBeNull();
  });

  it("keeps the last applied number format per workbook unit", () => {
    const selection = { sheet: "Data", address: "B2" };
    const keyA = appliedFormatKey("unit-a", selection);
    const keyB = appliedFormatKey("unit-b", selection);
    recordAppliedFormat(keyA, "0.00%");
    recordAppliedFormat(keyB, "#,##0");
    expect(readAppliedPattern(keyA)).toBe("0.00%");
    expect(readAppliedPattern(keyB)).toBe("#,##0");
    // A later selection in the same unit still replaces that unit's entry.
    recordAppliedFormat(appliedFormatKey("unit-a", { sheet: "Data", address: "C3" }), "0");
    expect(readAppliedPattern(keyA)).toBeNull();
    expect(readAppliedPattern(keyB)).toBe("#,##0");
  });
});

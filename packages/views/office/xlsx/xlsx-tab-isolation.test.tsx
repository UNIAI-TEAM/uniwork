import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OfficeDocumentActiveProvider } from "../common/document-active";
import { fireCommand } from "./fire-command";
import { OfficeRibbon } from "../ribbon";
import { appliedFormatKey, forgetAppliedFormat, readAppliedPattern, recordAppliedFormat } from "./number-format/applied-format";
import { xlsxNumberRibbonItems } from "./number-format/number-format-group";
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

  it("keeps the last applied number format per open document, even for the same bytes", async () => {
    // Two tabs of one template: the same Univer unit id, two documents.
    const formatGroup = (documentKey: string, testId: string) => (
      <div data-testid={testId}>
        <OfficeRibbon scope={`xlsx-iso-${testId}`} activeTabId="home"
          tabs={[{ id: "home", labelKey: "Home", groups: [{ id: "number", labelKey: "Number", priority: 0, items: xlsxNumberRibbonItems({ ...painterProps({ execute: vi.fn(() => true) }), unitId: "file-same-sha", documentKey, selection: { sheet: "Data", address: "B2" } }) }] }]} />
      </div>
    );
    render(<>{formatGroup("doc-a", "doc-a")}<OfficeDocumentActiveProvider active={false}>{formatGroup("doc-b", "doc-b")}</OfficeDocumentActiveProvider></>);
    const triggerA = within(screen.getByTestId("doc-a")).getByTestId("xlsx-number-format-trigger");
    const triggerB = within(screen.getByTestId("doc-b")).getByTestId("xlsx-number-format-trigger");
    const generalLabel = triggerB.textContent;
    fireEvent.click(screen.getByTestId("doc-a").querySelector<HTMLElement>("[data-ribbon-item='number-percent']")!);
    await waitFor(() => expect(triggerA.textContent).not.toBe(generalLabel));
    expect(triggerB.textContent).toBe(generalLabel);
  });

  it("drops a closed document's applied format", () => {
    const key = appliedFormatKey("doc-closed", { sheet: "Data", address: "B2" });
    recordAppliedFormat(key, "0.00%");
    expect(readAppliedPattern(key)).toBe("0.00%");
    forgetAppliedFormat("doc-closed");
    expect(readAppliedPattern(key)).toBeNull();
    // No document, no entry: a toolbar without a document key records nothing.
    expect(appliedFormatKey(undefined, { sheet: "Data", address: "B2" })).toBeNull();
  });
});

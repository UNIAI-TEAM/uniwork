import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxWorkbookSnapshot } from "@uniwork/office-engine/xlsx";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarGroupProps } from "../types";
import { XlsxTextToColumnsButton } from "./text-to-columns-dialog";

function lookup(key: string): string {
  return key.split(".").reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], viLocale) as string;
}
const D = "office.xlsx.dataTools.textToColumnsDialog";
const OK = "office.xlsx.dataTools.common.ok";

function snapshot(extra: Record<string, { value: string }> = {}): XlsxWorkbookSnapshot {
  return { revision: 1, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: "a,b" }, A2: { value: "c,d,e" }, ...extra } }] } as unknown as XlsxWorkbookSnapshot;
}

function setup(overrides: Partial<XlsxToolbarGroupProps> = {}, executeAsOneStep = vi.fn(async (_steps: readonly unknown[], _options?: unknown) => true)) {
  const props = {
    readOnly: false,
    selection: { sheet: "Data", address: "A1", endAddress: "A2" },
    canUndo: true, canRedo: true, canRecalculate: true, canFormat: true, recalculating: false,
    commands: { execute: vi.fn(), executeAsOneStep },
    snapshot: snapshot(),
    unitId: "file-sha",
    resolveSheetId: () => "sheet-1",
    onUndo: vi.fn(), onRedo: vi.fn(), onNumberFormat: vi.fn(), onRecalculate: vi.fn(), onCopy: vi.fn(), onPaste: vi.fn(), onShowSheets: vi.fn(),
    ...overrides,
  } as XlsxToolbarGroupProps;
  render(<XlsxTextToColumnsButton {...props} />);
  return { executeAsOneStep };
}

function pickComma() {
  fireEvent.click(screen.getByRole("checkbox", { name: lookup(`${D}.comma`) }));
}

type Step = { id: string; params: { range: unknown; value: Record<string, Record<string, Record<string, unknown>>> } };

describe("XlsxTextToColumnsButton", () => {
  it("splits at commas in one undo step", async () => {
    const { executeAsOneStep } = setup();
    expect(screen.getByTestId("xlsx-text-to-columns")).toHaveAccessibleName(lookup("office.xlsx.dataTools.textToColumns"));
    fireEvent.click(screen.getByTestId("xlsx-text-to-columns"));
    expect(screen.getByText(lookup(`${D}.title`))).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: lookup(`${D}.tab`) })).toBeChecked();
    pickComma();
    expect(screen.getByRole("table", { name: lookup(`${D}.preview`) })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: lookup(OK) }));
    await waitFor(() => expect(executeAsOneStep).toHaveBeenCalledTimes(1));
    const steps = executeAsOneStep.mock.calls[0]?.[0] as Step[];
    expect(steps).toHaveLength(1);
    expect(steps[0]?.id).toBe("sheet.command.set-range-values");
    expect(steps[0]?.params.range).toEqual({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 2 });
    expect(steps[0]?.params.value["0"]?.["1"]).toMatchObject({ v: "b" });
    expect(steps[0]?.params.value["0"]?.["2"]).toEqual({});
    expect(steps[0]?.params.value["1"]?.["2"]).toMatchObject({ v: "e" });
    // F1: atomic, so a refused write leaves nothing behind.
    expect(executeAsOneStep.mock.calls[0]?.[1]).toEqual({ atomic: true });
  });

  it("splits the values as of OK, after the queued grid edits, and fails when one failed (F3)", async () => {
    // A grid edit typed just before OK changed A2 to "x,y".
    const readLiveSnapshot = vi.fn(async () => snapshot({ A2: { value: "x,y" } }));
    const { executeAsOneStep } = setup({ readLiveSnapshot });
    fireEvent.click(screen.getByTestId("xlsx-text-to-columns"));
    pickComma();
    fireEvent.click(screen.getByRole("button", { name: lookup(OK) }));
    await waitFor(() => expect(executeAsOneStep).toHaveBeenCalledTimes(1));
    const steps = executeAsOneStep.mock.calls[0]?.[0] as Step[];
    expect(steps[0]?.params.range).toEqual({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
    expect(steps[0]?.params.value["1"]?.["0"]).toMatchObject({ v: "x" });
    expect(steps[0]?.params.value["1"]?.["1"]).toMatchObject({ v: "y" });
  });

  it("shows the failure when a queued grid edit failed (F3)", async () => {
    const { executeAsOneStep } = setup({ readLiveSnapshot: vi.fn(async () => { throw new Error("edit failed"); }) });
    fireEvent.click(screen.getByTestId("xlsx-text-to-columns"));
    pickComma();
    fireEvent.click(screen.getByRole("button", { name: lookup(OK) }));
    expect(await screen.findByText(lookup("office.xlsx.dataTools.common.failed"))).toBeInTheDocument();
    expect(executeAsOneStep).not.toHaveBeenCalled();
  });

  it("warns when cells to the right hold data", () => {
    setup({ snapshot: snapshot({ B1: { value: "keep" } }) });
    fireEvent.click(screen.getByTestId("xlsx-text-to-columns"));
    expect(screen.queryByText(lookup(`${D}.overwrite`))).not.toBeInTheDocument();
    pickComma();
    expect(screen.getByRole("alert")).toHaveTextContent(lookup(`${D}.overwrite`));
  });

  it("asks for a delimiter when none is chosen", () => {
    setup();
    fireEvent.click(screen.getByTestId("xlsx-text-to-columns"));
    fireEvent.click(screen.getByRole("checkbox", { name: lookup(`${D}.tab`) }));
    expect(screen.getByRole("alert")).toHaveTextContent(lookup(`${D}.noDelimiter`));
    expect(screen.getByRole("button", { name: lookup(OK) })).toBeDisabled();
  });

  it("guards a multi-column selection", () => {
    setup({ selection: { sheet: "Data", address: "A1", endAddress: "B2" } });
    fireEvent.click(screen.getByTestId("xlsx-text-to-columns"));
    expect(screen.getByRole("alert")).toHaveTextContent(lookup(`${D}.singleColumn`));
    expect(screen.getByRole("button", { name: lookup(OK) })).toBeDisabled();
  });

  it("shows the failure when the step is refused", async () => {
    setup({}, vi.fn(async (_steps: readonly unknown[]) => false));
    fireEvent.click(screen.getByTestId("xlsx-text-to-columns"));
    pickComma();
    fireEvent.click(screen.getByRole("button", { name: lookup(OK) }));
    expect(await screen.findByText(lookup("office.xlsx.dataTools.common.failed"))).toBeInTheDocument();
  });

  it.each([
    ["read-only", { readOnly: true }],
    ["no commands", { commands: undefined }],
    ["no snapshot", { snapshot: null }],
    ["no unit", { unitId: null }],
    ["no sheet", { resolveSheetId: () => undefined }],
    ["no selection", { selection: null }],
  ])("stays closed when blocked: %s", (_name, overrides) => {
    setup(overrides as Partial<XlsxToolbarGroupProps>);
    const button = screen.getByTestId("xlsx-text-to-columns");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(screen.queryByText(lookup(`${D}.title`))).not.toBeInTheDocument();
  });
});

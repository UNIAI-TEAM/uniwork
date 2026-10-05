import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxViewGoToGroup } from "./view-goto";

function renderGroup(overrides: Partial<XlsxToolbarGroupProps> = {}) {
  const execute = vi.fn<(id: string, params?: unknown) => boolean>(() => true);
  const props: XlsxToolbarGroupProps = {
    readOnly: false,
    selection: { sheet: "Data", address: "A1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute },
    formatState: null,
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
  render(<XlsxViewGoToGroup {...props} />);
  const input = screen.getByRole("textbox", { name: "Đi tới ô" });
  const submit = () => fireEvent.submit(screen.getByRole("button", { name: "Đi" }).closest("form")!);
  return { execute, input, submit };
}

describe("XlsxViewGoToGroup", () => {
  it("selects and reveals a single cell", () => {
    const { execute, input, submit } = renderGroup();
    fireEvent.change(input, { target: { value: "B5" } });
    submit();
    expect(execute.mock.calls).toEqual([
      ["sheet.operation.set-selections", {
        selections: [{
          range: { startRow: 4, endRow: 4, startColumn: 1, endColumn: 1 },
          primary: {
            startRow: 4,
            startColumn: 1,
            endRow: 4,
            endColumn: 1,
            actualRow: 4,
            actualColumn: 1,
            rangeType: 0,
            isMerged: false,
            isMergedMainCell: false,
          },
          style: null,
        }],
      }],
      ["sheet.command.scroll-to-cell", { range: { startRow: 4, endRow: 4, startColumn: 1, endColumn: 1 }, forceTop: true, forceLeft: true }],
    ]);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("selects and reveals a normalized range", () => {
    const { execute, input, submit } = renderGroup();
    fireEvent.change(input, { target: { value: "a1:c10" } });
    submit();
    expect(execute.mock.calls[0]![1]).toMatchObject({
      selections: [{ range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 2 } }],
    });
    expect(execute.mock.calls[1]).toEqual([
      "sheet.command.scroll-to-cell",
      { range: { startRow: 0, endRow: 9, startColumn: 0, endColumn: 2 }, forceTop: true, forceLeft: true },
    ]);
  });

  it("shows the inline message and leaves the selection alone for invalid input", () => {
    const { execute, input, submit } = renderGroup();
    fireEvent.change(input, { target: { value: "Data!A1" } });
    submit();
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Nhập một ô hoặc vùng, ví dụ B5 hoặc A1:C10.");
    expect(input).toHaveAttribute("aria-invalid", "true");
  });

  it("clears the message once the reference becomes valid", () => {
    const { execute, input, submit } = renderGroup();
    fireEvent.change(input, { target: { value: "nope" } });
    submit();
    expect(screen.getByRole("alert")).toBeInTheDocument();
    fireEvent.change(input, { target: { value: "C3" } });
    expect(screen.queryByRole("alert")).toBeNull();
    submit();
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("blocks the input without a renderer port", () => {
    renderGroup({ commands: undefined });
    expect(screen.getByRole("textbox", { name: "Đi tới ô" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Đi" })).toHaveAttribute("aria-disabled", "true");
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxGridFormatState } from "../xlsx-grid-surface";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxAlignmentGroup } from "./home-alignment";

function formatState(overrides: Partial<XlsxGridFormatState> = {}): XlsxGridFormatState {
  return {
    fontFamily: null,
    fontSize: null,
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    textColor: null,
    fillColor: null,
    horizontalAlign: null,
    verticalAlign: null,
    wrap: false,
    textRotation: null,
    ...overrides,
  };
}

function renderGroup(overrides: Partial<XlsxToolbarGroupProps> = {}) {
  const execute = vi.fn(() => true);
  const props: XlsxToolbarGroupProps = {
    readOnly: false,
    selection: { sheet: "Data", address: "A1" },
    canUndo: true,
    canRedo: true,
    canRecalculate: true,
    canFormat: true,
    recalculating: false,
    commands: { execute },
    formatState: formatState(),
    onUndo: vi.fn(),
    onRedo: vi.fn(),
    onNumberFormat: vi.fn(),
    onRecalculate: vi.fn(),
    onCopy: vi.fn(),
    onPaste: vi.fn(),
    onShowSheets: vi.fn(),
    ...overrides,
  };
  render(<XlsxAlignmentGroup {...props} />);
  return { execute };
}

const lastCall = (execute: ReturnType<typeof vi.fn>) => execute.mock.calls.at(-1);

describe("XlsxAlignmentGroup", () => {
  it("applies horizontal and vertical alignment and mirrors the active ones", () => {
    const { execute } = renderGroup({ formatState: formatState({ horizontalAlign: 2, verticalAlign: 3 }) });
    expect(screen.getByRole("button", { name: "Căn giữa" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Căn trái" })).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(screen.getByRole("button", { name: "Căn phải" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-horizontal-text-align", { value: 3 }]);
    expect(screen.getByRole("button", { name: "Căn dưới" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Căn trên" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-vertical-text-align", { value: 1 }]);
  });

  it("turns wrap off against a wrapped cell", () => {
    const wrapped = renderGroup({ formatState: formatState({ wrap: true }) });
    const wrap = screen.getByRole("button", { name: "Ngắt dòng" });
    expect(wrap).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(wrap);
    expect(lastCall(wrapped.execute)).toEqual(["sheet.command.set-text-wrap", { value: 1 }]);
  });

  it("turns wrap on when the mirrored cell does not wrap", () => {
    const { execute } = renderGroup({ formatState: formatState({ wrap: false }) });
    fireEvent.click(screen.getByRole("button", { name: "Ngắt dòng" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-text-wrap", { value: 3 }]);
  });

  it("sets a rotation angle from the picker", async () => {
    const { execute } = renderGroup({ formatState: formatState({ textRotation: 0 }) });
    fireEvent.click(screen.getByRole("combobox", { name: "Xoay chữ" }));
    // Base UI's Select commits on the pointer sequence; a bare click leaves the
    // item unselected (the shared control's version drift), so drive both.
    const angle = await screen.findByRole("option", { name: "45°" });
    fireEvent.pointerDown(angle);
    fireEvent.pointerUp(angle);
    fireEvent.click(angle);
    expect(lastCall(execute)).toEqual(["sheet.command.set-text-rotation", { value: 45 }]);
  });

  it("keeps blocked controls inert but reachable", () => {
    const { execute } = renderGroup({ readOnly: true });
    const left = screen.getByRole("button", { name: "Căn trái" });
    expect(left).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(left);
    expect(execute).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Xoay chữ" })).toBeDisabled();
  });
});

import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { XlsxToolbarGroupProps } from "./types";
import { XlsxViewZoomGroup } from "./view-zoom";

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
  render(<XlsxViewZoomGroup {...props} />);
  return { execute };
}

const lastCall = (execute: ReturnType<typeof vi.fn>) => execute.mock.calls.at(-1);
const zoomValue = () => screen.getByTestId("xlsx-view-zoom-value").textContent;

describe("XlsxViewZoomGroup", () => {
  it("steps the zoom through the absolute view command and echoes the percent", () => {
    const { execute } = renderGroup();
    expect(zoomValue()).toBe("100%");
    fireEvent.click(screen.getByRole("button", { name: "Phóng to" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-zoom-ratio", { zoomRatio: 1.1 }]);
    expect(zoomValue()).toBe("110%");
    fireEvent.click(screen.getByRole("button", { name: "Thu nhỏ" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-zoom-ratio", { zoomRatio: 1 }]);
    expect(zoomValue()).toBe("100%");
  });

  it("lands a preset on its exact percent with an absolute target", () => {
    const { execute } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Phóng to" }));
    fireEvent.click(screen.getByRole("button", { name: "Thu phóng 150%" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-zoom-ratio", { zoomRatio: 1.5 }]);
    expect(zoomValue()).toBe("150%");
    expect(screen.getByRole("button", { name: "Thu phóng 150%" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Thu phóng 100%" })).toHaveAttribute("aria-pressed", "false");
  });

  it("resets to 100% with an absolute target", () => {
    const { execute } = renderGroup();
    fireEvent.click(screen.getByRole("button", { name: "Thu phóng 200%" }));
    fireEvent.click(screen.getByRole("button", { name: "Đặt lại 100%" }));
    expect(lastCall(execute)).toEqual(["sheet.command.set-zoom-ratio", { zoomRatio: 1 }]);
    expect(zoomValue()).toBe("100%");
  });

  it("stays enabled but inert without a renderer port", () => {
    renderGroup({ commands: undefined });
    const zoomIn = screen.getByRole("button", { name: "Phóng to" });
    expect(zoomIn).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(zoomIn);
    expect(zoomValue()).toBe("100%");
  });
});
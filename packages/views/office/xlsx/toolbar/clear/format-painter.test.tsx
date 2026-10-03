import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarGroupProps } from "../types";
import {
  XLSX_FORMAT_PAINTER_OFF,
  XLSX_FORMAT_PAINTER_ONCE,
  XLSX_FORMAT_PAINTER_OPERATION,
  XlsxFormatPainterGroup,
} from "./format-painter";

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function text(key: string): string {
  const value = lookup(viLocale, key);
  if (typeof value !== "string") throw new Error(`missing vi locale key ${key}`);
  return value;
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
}

function renderPainter(overrides: Partial<XlsxToolbarGroupProps> = {}) {
  const execute = vi.fn(() => true);
  const props = groupProps({ commands: { execute }, ...overrides });
  const view = render(<XlsxFormatPainterGroup {...props} />);
  return { execute, props, view };
}

const ARM = [XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_ONCE }];
const CANCEL = [XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_OFF }];

describe("XlsxFormatPainterGroup", () => {
  it("arms once and cancels on the second press", () => {
    const { execute } = renderPainter();
    const button = screen.getByTestId("xlsx-format-painter");
    expect(button).toHaveAccessibleName(text("office.xlsx.toolbar.groups.painter.label"));
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(execute).toHaveBeenLastCalledWith(...ARM);
    expect(button).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(button);
    expect(execute).toHaveBeenLastCalledWith(...CANCEL);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("disarms with the off reset when the editor passes the next selection and stays single-use", () => {
    const { execute, props, view } = renderPainter();
    const button = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");

    view.rerender(<XlsxFormatPainterGroup {...props} selection={{ sheet: "Data", address: "B2" }} />);
    expect(execute).toHaveBeenLastCalledWith(...CANCEL);
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(execute).toHaveBeenLastCalledWith(...ARM);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("sends the off reset on a sheet switch that never reached a render apply", () => {
    const { execute, props, view } = renderPainter();
    const button = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "true");

    view.rerender(<XlsxFormatPainterGroup {...props} selection={{ sheet: "Archive", address: "A1" }} />);
    expect(execute).toHaveBeenLastCalledWith(...CANCEL);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("sends nothing for selection changes while unarmed", () => {
    const { execute, props, view } = renderPainter();
    view.rerender(<XlsxFormatPainterGroup {...props} selection={{ sheet: "Data", address: "C3" }} />);
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancels on Escape only while armed", () => {
    const { execute } = renderPainter();
    const button = screen.getByTestId("xlsx-format-painter");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(execute).not.toHaveBeenCalled();

    fireEvent.click(button);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(execute).toHaveBeenLastCalledWith(...CANCEL);
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("stays unarmed when the renderer refuses to arm", () => {
    const { execute } = renderPainter();
    execute.mockReturnValue(false);
    const button = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(button);
    expect(execute).toHaveBeenCalledWith(...ARM);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("is aria-disabled and inert while read-only or without a command port", () => {
    const { execute } = renderPainter({ readOnly: true });
    const button = screen.getByTestId("xlsx-format-painter");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(execute).not.toHaveBeenCalled();
  });

  it("is inert without a command port", () => {
    renderPainter({ commands: undefined });
    const button = screen.getByTestId("xlsx-format-painter");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("is inert without a selection", () => {
    const { execute } = renderPainter({ canFormat: false, selection: null });
    const button = screen.getByTestId("xlsx-format-painter");
    expect(button).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(button);
    expect(execute).not.toHaveBeenCalled();
  });
});

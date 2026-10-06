import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import type { XlsxToolbarGroupProps } from "../types";
import { useXlsxViewEcho } from "../view-echo";
import {
  XLSX_FORMAT_PAINTER_OFF,
  XLSX_FORMAT_PAINTER_ONCE,
  XLSX_FORMAT_PAINTER_OPERATION,
  XlsxFormatPainterButton,
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
  const view = render(<XlsxFormatPainterButton {...props} />);
  return { execute, props, view };
}

const ARM = [XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_ONCE }];
const CANCEL = [XLSX_FORMAT_PAINTER_OPERATION, { status: XLSX_FORMAT_PAINTER_OFF }];

describe("XlsxFormatPainterButton", () => {
  it("arms once and cancels on the second press", async () => {
    const { execute } = renderPainter();
    const button = screen.getByTestId("xlsx-format-painter");
    expect(button).toHaveAccessibleName(text("office.xlsx.toolbar.groups.painter.label"));
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(execute).toHaveBeenLastCalledWith(...ARM);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));

    fireEvent.click(button);
    expect(execute).toHaveBeenLastCalledWith(...CANCEL);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("disarms with the off reset when the editor passes the next selection and stays single-use", async () => {
    const { execute, props, view } = renderPainter();
    const button = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));

    view.rerender(<XlsxFormatPainterButton {...props} selection={{ sheet: "Data", address: "B2" }} />);
    expect(execute).toHaveBeenLastCalledWith(...CANCEL);
    expect(button).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(button);
    expect(execute).toHaveBeenLastCalledWith(...ARM);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it("sends the off reset on a sheet switch that never reached a render apply", async () => {
    const { execute, props, view } = renderPainter();
    const button = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));

    view.rerender(<XlsxFormatPainterButton {...props} selection={{ sheet: "Archive", address: "A1" }} />);
    expect(execute).toHaveBeenLastCalledWith(...CANCEL);
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("sends nothing for selection changes while unarmed", () => {
    const { execute, props, view } = renderPainter();
    view.rerender(<XlsxFormatPainterButton {...props} selection={{ sheet: "Data", address: "C3" }} />);
    expect(execute).not.toHaveBeenCalled();
  });

  it("cancels on Escape only while armed", async () => {
    const { execute } = renderPainter();
    const button = screen.getByTestId("xlsx-format-painter");

    fireEvent.keyDown(window, { key: "Escape" });
    expect(execute).not.toHaveBeenCalled();

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "true"));
    // The arm lands from a resolved promise, outside act: aria-pressed can
    // commit before the passive effect adds the Escape listener. Retry the key
    // until it is heard; once disarmed the listener is gone, so a retry after
    // the cancel is a no-op and the call count below still pins one cancel.
    await waitFor(() => {
      fireEvent.keyDown(window, { key: "Escape" });
      expect(execute).toHaveBeenLastCalledWith(...CANCEL);
    });
    await waitFor(() => expect(button).toHaveAttribute("aria-pressed", "false"));

    fireEvent.keyDown(window, { key: "Escape" });
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("stays unarmed when the renderer refuses to arm", async () => {
    const { execute } = renderPainter();
    execute.mockResolvedValue(false);
    const button = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(button);
    expect(execute).toHaveBeenCalledWith(...ARM);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
    expect(button).toHaveAttribute("aria-pressed", "false");
  });

  it("stays unarmed when the dispatch rejects", async () => {
    const { execute } = renderPainter();
    execute.mockRejectedValue(new Error("handler exploded"));
    const button = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(button);
    await waitFor(() => expect(execute).toHaveBeenCalledTimes(1));
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

  it("keeps the engine armed across a remount (ribbon tab switch) with the hoisted echo", async () => {
    const execute = vi.fn(() => true);
    const selection = { sheet: "Data", address: "A1" };

    // The toolbar owns the echo and stays mounted; the ribbon only drops the
    // inactive tab's GROUPS. `mounted` models that: the group unmounts and
    // remounts while the echo it reads survives.
    function Harness({ mounted }: { mounted: boolean }) {
      const viewEcho = useXlsxViewEcho();
      if (!mounted) return null;
      return <XlsxFormatPainterButton {...groupProps({ commands: { execute }, selection, viewEcho })} />;
    }

    const view = render(<Harness mounted />);
    const armButton = screen.getByTestId("xlsx-format-painter");
    fireEvent.click(armButton);
    await waitFor(() => expect(armButton).toHaveAttribute("aria-pressed", "true"));
    expect(execute).toHaveBeenLastCalledWith(...ARM);

    // Tab away: the group unmounts. Nothing runs on unmount - the engine stays
    // armed (Excel keeps the painter across tab switches).
    view.rerender(<Harness mounted={false} />);
    expect(screen.queryByTestId("xlsx-format-painter")).not.toBeInTheDocument();
    expect(execute).toHaveBeenCalledTimes(1);

    // Tab back: a fresh mount must read the armed mirror and show it pressed,
    // with the SAME selection so no spurious off reset fires.
    view.rerender(<Harness mounted />);
    const remounted = screen.getByTestId("xlsx-format-painter");
    expect(remounted).toHaveAttribute("aria-pressed", "true");
    expect(execute).toHaveBeenCalledTimes(1);
  });
});
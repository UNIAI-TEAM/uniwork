import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocxEditorHandle, DocxSelection } from "../types";
import { useFormatPainter } from "./format-painter";

function setup({ copy = true, selection = { blockId: null, from: 1, to: 4 } as DocxSelection | null } = {}) {
  const listeners = new Set<(next: DocxSelection | null) => void>();
  let current = selection;
  const commands = {
    copyCharacterFormat: vi.fn(() => copy),
    applyCharacterFormat: vi.fn(() => true),
    clearCharacterFormat: vi.fn(),
  };
  const editor = {
    selection: {
      getSelection: () => current,
      subscribe: (listener: (next: DocxSelection | null) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
  } as unknown as DocxEditorHandle;
  const emit = (next: DocxSelection | null) => {
    current = next;
    act(() => {
      for (const listener of listeners) listener(next);
    });
  };
  return { editor, commands, emit };
}

describe("useFormatPainter", () => {
  it("arms on toggle and cancels on the second toggle without applying", () => {
    const { editor, commands } = setup();
    const { result } = renderHook(() => useFormatPainter({ editor, commands, disabled: false }));

    act(() => result.current.toggle());
    expect(result.current.armed).toBe(true);
    expect(commands.copyCharacterFormat).toHaveBeenCalledTimes(1);

    act(() => result.current.toggle());
    expect(result.current.armed).toBe(false);
    expect(commands.clearCharacterFormat).toHaveBeenCalledTimes(1);
    expect(commands.applyCharacterFormat).not.toHaveBeenCalled();
  });

  it("applies to the next selection that moved, then disarms", () => {
    const { editor, commands, emit } = setup();
    const { result } = renderHook(() => useFormatPainter({ editor, commands, disabled: false }));

    act(() => result.current.toggle());
    emit({ blockId: null, from: 7, to: 12 });

    expect(commands.applyCharacterFormat).toHaveBeenCalledTimes(1);
    expect(result.current.armed).toBe(false);

    emit({ blockId: null, from: 1, to: 2 });
    expect(commands.applyCharacterFormat).toHaveBeenCalledTimes(1);
  });

  it("ignores the pickup selection's own emissions", () => {
    const { editor, commands, emit } = setup();
    const { result } = renderHook(() => useFormatPainter({ editor, commands, disabled: false }));

    act(() => result.current.toggle());
    emit({ blockId: null, from: 1, to: 4 });
    expect(commands.applyCharacterFormat).not.toHaveBeenCalled();
    expect(result.current.armed).toBe(true);
  });

  it("cancels on Escape while armed", () => {
    const { editor, commands } = setup();
    const { result } = renderHook(() => useFormatPainter({ editor, commands, disabled: false }));

    act(() => result.current.toggle());
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(result.current.armed).toBe(false);
    expect(commands.clearCharacterFormat).toHaveBeenCalledTimes(1);
    expect(commands.applyCharacterFormat).not.toHaveBeenCalled();
  });

  it("does not arm when disabled, when no commands are wired, or when the capture fails", () => {
    const failing = setup({ copy: false });
    const first = renderHook(() =>
      useFormatPainter({ editor: failing.editor, commands: failing.commands, disabled: false }),
    );
    act(() => first.result.current.toggle());
    expect(first.result.current.armed).toBe(false);
    expect(failing.commands.copyCharacterFormat).toHaveBeenCalledTimes(1);

    const disabled = setup();
    const second = renderHook(() =>
      useFormatPainter({ editor: disabled.editor, commands: disabled.commands, disabled: true }),
    );
    act(() => second.result.current.toggle());
    expect(second.result.current.armed).toBe(false);
    expect(disabled.commands.copyCharacterFormat).not.toHaveBeenCalled();

    const bare = setup();
    const third = renderHook(() => useFormatPainter({ editor: bare.editor, disabled: false }));
    act(() => third.result.current.toggle());
    expect(third.result.current.armed).toBe(false);
    expect(bare.commands.copyCharacterFormat).not.toHaveBeenCalled();
  });

  it("cancels an armed brush when the document turns read-only", () => {
    const { editor, commands } = setup();
    const { result, rerender } = renderHook(
      ({ disabled }: { disabled: boolean }) => useFormatPainter({ editor, commands, disabled }),
      { initialProps: { disabled: false } },
    );

    act(() => result.current.toggle());
    expect(result.current.armed).toBe(true);
    rerender({ disabled: true });
    expect(result.current.armed).toBe(false);
    expect(commands.clearCharacterFormat).toHaveBeenCalledTimes(1);
  });
});

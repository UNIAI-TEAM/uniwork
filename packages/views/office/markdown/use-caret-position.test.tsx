// T12 (UNI-939): the Markdown status row's caret position, source and visual.
import { act, render, renderHook, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it } from "vitest";
import { useMarkdownCaret, visualCaret } from "./use-caret-position";

describe("useMarkdownCaret (source mode)", () => {
  it("follows the textarea selection and reports 1-based line and column", () => {
    render(<textarea data-testid="area" defaultValue={"ab\ncde"} />);
    const area = screen.getByTestId("area") as HTMLTextAreaElement;
    const ref = createRef<HTMLTextAreaElement>() as { current: HTMLTextAreaElement | null };
    ref.current = area;
    const { result } = renderHook(() => useMarkdownCaret("source", null, ref, true));
    expect(result.current).toEqual({ line: 1, column: 1 });
    act(() => {
      area.setSelectionRange(5, 5);
      area.dispatchEvent(new Event("keyup"));
    });
    expect(result.current).toEqual({ line: 2, column: 3 });
  });

  it("reports nothing before the document is ready or without a textarea", () => {
    const ref = { current: null as HTMLTextAreaElement | null };
    expect(renderHook(() => useMarkdownCaret("source", null, ref, false)).result.current).toBeNull();
    expect(renderHook(() => useMarkdownCaret("visual", null, ref, true)).result.current).toBeNull();
  });
});

describe("visualCaret", () => {
  it("counts blocks as lines and the offset inside the block as the column", () => {
    const editor = {
      state: { selection: { head: 7 }, doc: { textBetween: (_from: number, to: number, sep: string) => (to === 7 ? `one${sep}tw` : "") } },
    } as unknown as Parameters<typeof visualCaret>[0];
    expect(visualCaret(editor)).toEqual({ line: 2, column: 3 });
  });
});

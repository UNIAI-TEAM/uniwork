import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSmoothText } from "./use-smooth-text";

let frames = new Map<number, FrameRequestCallback>();
let nextFrame = 0;
const flushFrame = () => {
  const run = [...frames.values()];
  frames = new Map();
  act(() => run.forEach((f) => f(0)));
};

beforeEach(() => {
  frames = new Map();
  vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
    frames.set(++nextFrame, f);
    return nextFrame;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
});

afterEach(() => vi.unstubAllGlobals());

describe("useSmoothText", () => {
  it("reveals a burst over a few frames, never jumping past the text", () => {
    const { result, rerender } = renderHook(({ text }) => useSmoothText(text, true), { initialProps: { text: "" } });
    const burst = "x".repeat(100);
    rerender({ text: burst });
    expect(result.current).toBe("");
    flushFrame();
    expect(result.current).toHaveLength(10);
    flushFrame();
    expect(result.current).toHaveLength(19);
    for (let i = 0; i < 60 && frames.size > 0; i++) flushFrame();
    expect(result.current).toBe(burst);
    expect(frames.size).toBe(0);
  });

  it("starts again from the first character when the text is replaced by a shorter one", () => {
    const { result, rerender } = renderHook(({ text }) => useSmoothText(text, true), { initialProps: { text: "lead-in" } });
    rerender({ text: "" });
    rerender({ text: "answer" });
    flushFrame();
    expect(result.current).toBe("a");
  });

  it("shows the whole text at once when inactive", () => {
    const { result, rerender } = renderHook(({ text, active }) => useSmoothText(text, active), { initialProps: { text: "", active: true } });
    rerender({ text: "done answer", active: false });
    expect(result.current).toBe("done answer");
  });
});

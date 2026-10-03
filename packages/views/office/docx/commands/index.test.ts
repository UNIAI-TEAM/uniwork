import { describe, expect, it, vi } from "vitest";
import { createDocxCommandRuntime, type DocxCommandAreaFactory, type DocxCommandRuntime } from "./index";

describe("createDocxCommandRuntime", () => {
  it("exposes the base commands and the default state before a document opens", () => {
    const runtime = createDocxCommandRuntime(() => null);
    expect(runtime.getState()).toMatchObject({ bold: false, italic: false, underline: false, headingLevel: null, listKind: null });
    expect(() => runtime.toggleBold()).not.toThrow();
    expect(() => runtime.setHeading(2)).not.toThrow();
    expect(() => runtime.toggleList("bullet")).not.toThrow();
    expect(typeof runtime.subscribe).toBe("function");
  });

  it("composes a fake area factory into the commands and the merged format state", () => {
    let reviewed = false;
    const fakeArea: DocxCommandAreaFactory<{ markReviewed(): void }, { reviewed: boolean }> = () => ({
      commands: {
        markReviewed: () => {
          reviewed = true;
        },
      },
      readState: () => ({ reviewed }),
    });
    const runtime = createDocxCommandRuntime(() => null, { areas: [fakeArea] }) as DocxCommandRuntime & { markReviewed(): void };

    runtime.markReviewed();
    expect(reviewed).toBe(true);
    expect((runtime.getState() as { reviewed?: boolean }).reviewed).toBe(true);
    expect(runtime.getState()).toMatchObject({ bold: false });
  });

  it("notifies subscribers with the composed state and clearListeners drops them", () => {
    const runtime = createDocxCommandRuntime(() => null);
    const listener = vi.fn();
    const unsubscribe = runtime.subscribe(listener);

    runtime.emitState();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ bold: false, italic: false, underline: false, headingLevel: null, listKind: null }));

    unsubscribe();
    runtime.emitState();
    expect(listener).toHaveBeenCalledTimes(1);

    const pending = vi.fn();
    runtime.subscribe(pending);
    runtime.clearListeners();
    runtime.emitState();
    expect(pending).not.toHaveBeenCalled();
  });
});

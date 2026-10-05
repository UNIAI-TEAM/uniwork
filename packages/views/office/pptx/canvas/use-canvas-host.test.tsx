import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PptxRendererModule } from "./renderer-module";
import { usePptxRendererModule } from "./use-canvas-host";

const module: PptxRendererModule = {
  buildRenderSlide: () => {
    throw new Error("not used by this suite");
  },
  makeViewport: () => ({ widthPx: 1, heightPx: 1, scale: 1 }),
};

describe("usePptxRendererModule", () => {
  it("keeps the bundle unloaded until the canvas has a deck, then loads once", async () => {
    const load = vi.fn(async () => module);
    const { result, rerender } = renderHook(({ enabled }: { enabled: boolean }) => usePptxRendererModule(load, enabled), {
      initialProps: { enabled: false },
    });
    expect(result.current.status).toBe("loading");
    expect(load).not.toHaveBeenCalled();
    rerender({ enabled: true });
    await waitFor(() => expect(result.current.status).toBe("ready"));
    expect(load).toHaveBeenCalledTimes(1);
    rerender({ enabled: false });
    expect(result.current.status).toBe("ready");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("surfaces a rejected loader as an error state with its message", async () => {
    const { result } = renderHook(() => usePptxRendererModule(async () => {
      throw new Error("bundle missing");
    }));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current).toEqual({ status: "error", message: "bundle missing" });
  });
});

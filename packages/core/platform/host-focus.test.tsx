import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useHostFocus } from "./host-focus";

type Win = Window & { desktopAPI?: unknown };

function setVisibility(state: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
}

afterEach(() => {
  delete (window as Win).desktopAPI;
  setVisibility("visible");
});

describe("useHostFocus without a bridge", () => {
  it("reads document.visibilityState on every render", () => {
    setVisibility("hidden");
    const { result, rerender } = renderHook(() => useHostFocus());
    expect(result.current).toBe(false);
    // A test that flips the property without firing an event still sees the change.
    setVisibility("visible");
    rerender();
    expect(result.current).toBe(true);
  });

  it("follows visibilitychange", () => {
    const { result } = renderHook(() => useHostFocus());
    expect(result.current).toBe(true);
    setVisibility("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(result.current).toBe(false);
  });
});

describe("useHostFocus inside UniChat", () => {
  it("takes the window focus from the bridge, not the tab visibility", async () => {
    let onChange: ((focused: boolean) => void) | null = null;
    const off = vi.fn();
    (window as Win).desktopAPI = {
      app: "unichat",
      isFocused: () => Promise.resolve(false),
      onFocusChange: (cb: (focused: boolean) => void) => {
        onChange = cb;
        return off;
      },
    };
    setVisibility("visible");
    const { result, unmount } = renderHook(() => useHostFocus());
    await waitFor(() => expect(result.current).toBe(false));

    act(() => onChange?.(true));
    expect(result.current).toBe(true);

    unmount();
    expect(off).toHaveBeenCalledTimes(1);
  });
});

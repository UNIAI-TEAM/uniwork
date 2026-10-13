import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ACCENT_STORAGE_KEY } from "../lib/accent";
import { useAccent } from "./use-accent";

describe("useAccent", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-accent");
    document.documentElement.removeAttribute("style");
  });

  it("starts on the accent the page already carries", () => {
    // The boot script set the attribute before React ran; the hook reads it.
    document.documentElement.setAttribute("data-accent", "teal");
    const { result } = renderHook(() => useAccent());
    expect(result.current.accent).toBe("teal");
  });

  it("matches the page, not storage, when storage is blocked", () => {
    // A pick made with storage blocked lives only on <html>. Reading storage
    // on remount would check UniWork while the page is still mint, and a
    // click on the already-checked UniWork chip would do nothing.
    document.documentElement.setAttribute("data-accent", "mint");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const { result } = renderHook(() => useAccent());
    expect(result.current.accent).toBe("mint");
  });

  it("starts on the default when the page carries an unknown accent", () => {
    document.documentElement.setAttribute("data-accent", "chartreuse");
    const { result } = renderHook(() => useAccent());
    expect(result.current.accent).toBe("uniwork");
  });

  it("applies and stores the accent picked", () => {
    const { result } = renderHook(() => useAccent());
    act(() => result.current.setAccent("blue"));
    expect(result.current.accent).toBe("blue");
    expect(document.documentElement.getAttribute("data-accent")).toBe("blue");
    expect(window.localStorage.getItem(ACCENT_STORAGE_KEY)).toBe("blue");
  });

  it("still applies the accent when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const { result } = renderHook(() => useAccent());
    act(() => result.current.setAccent("pink"));
    expect(result.current.accent).toBe("pink");
    expect(document.documentElement.getAttribute("data-accent")).toBe("pink");
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useAccent());
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "orange");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: ACCENT_STORAGE_KEY }));
    });
    expect(result.current.accent).toBe("orange");
    expect(document.documentElement.getAttribute("data-accent")).toBe("orange");
  });

  it("ignores storage events for other keys", () => {
    const { result } = renderHook(() => useAccent());
    window.localStorage.setItem(ACCENT_STORAGE_KEY, "orange");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "uniwork-text-size" }));
    });
    expect(result.current.accent).toBe("uniwork");
    expect(document.documentElement.hasAttribute("data-accent")).toBe(false);
  });
});

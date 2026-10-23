import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TEXT_SIZE_STORAGE_KEY } from "../lib/text-size";
import { useTextSize } from "./use-text-size";

describe("useTextSize", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  it("starts on the level the page already carries", () => {
    // The boot script set the attribute before React ran; the hook reads it.
    document.documentElement.setAttribute("data-text-size", "large");
    const { result } = renderHook(() => useTextSize());
    expect(result.current.textSize).toBe("large");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
  });

  it("matches the page, not storage, when storage is blocked", () => {
    // A pick made with storage blocked lives only on <html>. Reading storage
    // on remount would check Default while the page is Extra large, and a
    // click on the already-checked Default would do nothing.
    document.documentElement.setAttribute("data-text-size", "xlarge");
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const { result } = renderHook(() => useTextSize());
    expect(result.current.textSize).toBe("xlarge");
  });

  it("starts on the default when the page carries an unknown level", () => {
    document.documentElement.setAttribute("data-text-size", "huge");
    const { result } = renderHook(() => useTextSize());
    expect(result.current.textSize).toBe("default");
  });

  it("applies and stores the level picked", () => {
    const { result } = renderHook(() => useTextSize());
    act(() => result.current.setTextSize("xlarge"));
    expect(result.current.textSize).toBe("xlarge");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("xlarge");
    expect(window.localStorage.getItem(TEXT_SIZE_STORAGE_KEY)).toBe("xlarge");
  });

  it("still applies the level when storage refuses the write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("storage blocked");
    });
    const { result } = renderHook(() => useTextSize());
    act(() => result.current.setTextSize("large"));
    expect(result.current.textSize).toBe("large");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
  });

  it("follows a change made in another tab", () => {
    const { result } = renderHook(() => useTextSize());
    window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "xlarge");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: TEXT_SIZE_STORAGE_KEY }));
    });
    expect(result.current.textSize).toBe("xlarge");
    expect(document.documentElement.getAttribute("data-text-size")).toBe("xlarge");
  });

  it("ignores storage events for other keys", () => {
    const { result } = renderHook(() => useTextSize());
    window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "xlarge");
    act(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "uniwork-accent" }));
    });
    expect(result.current.textSize).toBe("default");
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
  });
});

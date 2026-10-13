import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TEXT_SIZE,
  TEXT_SIZE_STORAGE_KEY,
  applyTextSize,
  isTextSize,
  readStoredTextSize,
  textSizeBootScript,
} from "./text-size";

function blockStorage(method: "getItem" | "setItem") {
  vi.spyOn(Storage.prototype, method).mockImplementation(() => {
    throw new Error("storage blocked");
  });
}

describe("text size", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
    document.documentElement.removeAttribute("data-text-size");
  });

  it("writes the level onto the root and clears it for the default", () => {
    const root = document.documentElement;
    applyTextSize("xlarge", root);
    expect(root.getAttribute("data-text-size")).toBe("xlarge");
    // :root already holds scale 1, so the default needs no attribute.
    applyTextSize(DEFAULT_TEXT_SIZE, root);
    expect(root.hasAttribute("data-text-size")).toBe(false);
  });

  it("accepts only the three level names", () => {
    for (const name of ["default", "large", "xlarge"]) expect(isTextSize(name)).toBe(true);
    for (const value of ["xxl", "", "LARGE", null, 1]) expect(isTextSize(value)).toBe(false);
  });

  it("falls back to the default for an unknown stored value", () => {
    window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "xxl");
    expect(readStoredTextSize()).toBe(DEFAULT_TEXT_SIZE);
  });

  it("falls back to the default when storage is blocked", () => {
    blockStorage("getItem");
    expect(readStoredTextSize()).toBe(DEFAULT_TEXT_SIZE);
  });

  it("boots the stored level before paint", () => {
    // The script ships as a string in the document, so a syntax error would
    // only surface as text that never grows in the browser. Run it here.
    window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, "large");
    new Function(textSizeBootScript())();
    expect(document.documentElement.getAttribute("data-text-size")).toBe("large");
  });

  it("boots nothing for the default, a stale value or blocked storage", () => {
    for (const stored of ["default", "xxl", ""]) {
      window.localStorage.setItem(TEXT_SIZE_STORAGE_KEY, stored);
      new Function(textSizeBootScript())();
      expect(document.documentElement.hasAttribute("data-text-size"), stored).toBe(false);
    }
    blockStorage("getItem");
    expect(() => new Function(textSizeBootScript())()).not.toThrow();
    expect(document.documentElement.hasAttribute("data-text-size")).toBe(false);
  });
});

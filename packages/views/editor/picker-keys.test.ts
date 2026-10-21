import { describe, expect, it } from "vitest";
import { isPickerAcceptKey, pickerNavigationDirection } from "./picker-keys";

function key(k: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: k, ...init });
}

describe("pickerNavigationDirection", () => {
  it("moves with the arrow keys", () => {
    expect(pickerNavigationDirection(key("ArrowDown"))).toBe("next");
    expect(pickerNavigationDirection(key("ArrowUp"))).toBe("prev");
  });

  it("keeps Ctrl+J / Ctrl+K as readline aliases, Caps Lock included", () => {
    expect(pickerNavigationDirection(key("j", { ctrlKey: true }))).toBe("next");
    expect(pickerNavigationDirection(key("k", { ctrlKey: true }))).toBe("prev");
    expect(pickerNavigationDirection(key("J", { ctrlKey: true }))).toBe("next");
  });

  it("leaves Ctrl+N and Ctrl+P to the browser (Chromium reserves Ctrl+N)", () => {
    expect(pickerNavigationDirection(key("n", { ctrlKey: true }))).toBeNull();
    expect(pickerNavigationDirection(key("p", { ctrlKey: true }))).toBeNull();
    expect(pickerNavigationDirection(key("N", { ctrlKey: true }))).toBeNull();
  });

  it("ignores the letter aliases with another modifier", () => {
    expect(pickerNavigationDirection(key("j", { ctrlKey: true, shiftKey: true }))).toBeNull();
    expect(pickerNavigationDirection(key("j", { metaKey: true }))).toBeNull();
    expect(pickerNavigationDirection(key("j"))).toBeNull();
  });
});

describe("isPickerAcceptKey", () => {
  it("accepts Enter and plain Tab only", () => {
    expect(isPickerAcceptKey(key("Enter"))).toBe(true);
    expect(isPickerAcceptKey(key("Tab"))).toBe(true);
    expect(isPickerAcceptKey(key("Tab", { shiftKey: true }))).toBe(false);
    expect(isPickerAcceptKey(key("Tab", { ctrlKey: true }))).toBe(false);
  });
});

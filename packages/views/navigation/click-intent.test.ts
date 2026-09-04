import { describe, expect, it } from "vitest";
import { resolveClickIntent } from "./click-intent";

describe("resolveClickIntent", () => {
  it("maps plain and modified clicks to navigation intents", () => {
    expect(resolveClickIntent({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false })).toBe(
      "push",
    );
    expect(resolveClickIntent({ button: 1, metaKey: false, ctrlKey: false, shiftKey: false })).toBe(
      "background-tab",
    );
    expect(resolveClickIntent({ button: 0, metaKey: true, ctrlKey: false, shiftKey: false })).toBe(
      "background-tab",
    );
    expect(resolveClickIntent({ button: 0, metaKey: false, ctrlKey: true, shiftKey: false })).toBe(
      "background-tab",
    );
    expect(resolveClickIntent({ button: 0, metaKey: true, ctrlKey: false, shiftKey: true })).toBe(
      "foreground-tab",
    );
    expect(resolveClickIntent({ button: 0, metaKey: false, ctrlKey: false, shiftKey: true })).toBe(
      "push",
    );
  });
});

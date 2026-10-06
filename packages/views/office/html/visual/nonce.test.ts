import { afterEach, describe, expect, it, vi } from "vitest";
import { createVisualEditNonce } from "./nonce";

afterEach(() => vi.unstubAllGlobals());

describe("createVisualEditNonce", () => {
  it("is 32 lowercase hex characters and differs per call", () => {
    const a = createVisualEditNonce();
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(createVisualEditNonce()).not.toBe(a);
  });

  it("throws, never guesses, when there is no randomness source", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => createVisualEditNonce()).toThrow();
  });
});

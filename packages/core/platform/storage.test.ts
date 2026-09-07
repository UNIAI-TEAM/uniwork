import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultStorage, sessionStorageAdapter } from "./storage";

describe("defaultStorage", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("round-trips through localStorage", () => {
    defaultStorage.setItem("k", "v");
    expect(defaultStorage.getItem("k")).toBe("v");
    defaultStorage.removeItem("k");
    expect(defaultStorage.getItem("k")).toBeNull();
  });

  it("is SSR-safe when window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(defaultStorage.getItem("k")).toBeNull();
    expect(() => defaultStorage.setItem("k", "v")).not.toThrow();
    expect(() => defaultStorage.removeItem("k")).not.toThrow();
  });
});

describe("sessionStorageAdapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    sessionStorage.clear();
  });

  it("round-trips through sessionStorage", () => {
    sessionStorageAdapter.setItem("k", "v");
    expect(sessionStorageAdapter.getItem("k")).toBe("v");
    sessionStorageAdapter.removeItem("k");
    expect(sessionStorageAdapter.getItem("k")).toBeNull();
  });

  it("is SSR-safe when window is undefined", () => {
    vi.stubGlobal("window", undefined);
    expect(sessionStorageAdapter.getItem("k")).toBeNull();
    expect(() => sessionStorageAdapter.setItem("k", "v")).not.toThrow();
    expect(() => sessionStorageAdapter.removeItem("k")).not.toThrow();
  });
});

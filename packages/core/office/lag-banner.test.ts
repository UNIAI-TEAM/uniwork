import { describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCUMENT_LIMITS } from "../documents/limits";
import type { StorageAdapter } from "../types/storage";
import {
  LAG_BANNER_DISMISSED_PREFIX,
  dismissLagBanner,
  isLagBannerDismissed,
  lagBannerDismissedKey,
  shouldShowSizeFallbackLagBanner,
  supportsLagPerformanceObserver,
} from "./lag-banner";

function memoryStorage(): StorageAdapter {
  const map = new Map<string, string>();
  return {
    getItem: vi.fn((key: string) => map.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { map.set(key, value); }),
    removeItem: vi.fn((key: string) => { map.delete(key); }),
  };
}

describe("lag-banner helpers", () => {
  it("detects PerformanceObserver support for longtask or event without user-agent sniffing", () => {
    expect(supportsLagPerformanceObserver({ supportedEntryTypes: ["longtask", "measure"] })).toBe(true);
    expect(supportsLagPerformanceObserver({ supportedEntryTypes: ["navigation", "event"] })).toBe(true);
    expect(supportsLagPerformanceObserver({ supportedEntryTypes: ["navigation", "paint"] })).toBe(false);
    expect(supportsLagPerformanceObserver({})).toBe(false);
    expect(supportsLagPerformanceObserver(null)).toBe(false);
  });

  it("triggers the size fallback only when the observer is absent and size exceeds web_open[format].warn_bytes", () => {
    const webOpen = DEFAULT_DOCUMENT_LIMITS.web_open;
    expect(shouldShowSizeFallbackLagBanner({
      format: "xlsx",
      sizeBytes: webOpen.xlsx.warn_bytes + 1,
      webOpen,
      hasObserver: false,
    })).toBe(true);
    expect(shouldShowSizeFallbackLagBanner({
      format: "xlsx",
      sizeBytes: webOpen.xlsx.warn_bytes,
      webOpen,
      hasObserver: false,
    })).toBe(false);
    expect(shouldShowSizeFallbackLagBanner({
      format: "xlsx",
      sizeBytes: webOpen.xlsx.warn_bytes + 10_000_000,
      webOpen,
      hasObserver: true,
    })).toBe(false);
    expect(shouldShowSizeFallbackLagBanner({
      format: "md",
      sizeBytes: 100_000_000,
      webOpen,
      hasObserver: false,
    })).toBe(false);
  });

  it("remembers dismissal per document through StorageAdapter under office.lagBanner.dismissed:<documentId>", () => {
    const storage = memoryStorage();
    expect(lagBannerDismissedKey("doc-1")).toBe(`${LAG_BANNER_DISMISSED_PREFIX}doc-1`);
    expect(isLagBannerDismissed("doc-1", storage)).toBe(false);
    dismissLagBanner("doc-1", storage);
    expect(storage.setItem).toHaveBeenCalledWith("office.lagBanner.dismissed:doc-1", "1");
    expect(isLagBannerDismissed("doc-1", storage)).toBe(true);
    expect(isLagBannerDismissed("doc-2", storage)).toBe(false);
  });
});

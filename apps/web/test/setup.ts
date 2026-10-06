// Shared vitest setup for apps/web.
//
// The web Office host suites import the shared pptx view graph, whose per-panel
// i18n modules register their bundles at module-import time through
// react-i18next's getI18n(). Those modules evaluate before a test file's body
// runs, so initI18n() must happen here - in a setup file Vitest runs before the
// test module - or getI18n() is undefined and registration throws before any
// assertion can execute.
import { initI18n } from "@uniwork/core/i18n";

initI18n();

// jsdom ships no matchMedia / IntersectionObserver / ResizeObserver; the shared
// editor canvas (packages/ui hooks + views canvas) mounts with all three. These
// are the same shims the packages/ui and packages/views setups install.
if (typeof window !== "undefined") {
  const evaluate = (query: string): boolean => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    if (min) return window.innerWidth >= Number(min[1]);
    const max = /\(max-width:\s*(\d+)px\)/.exec(query);
    if (max) return window.innerWidth <= Number(max[1]);
    return false;
  };
  window.matchMedia ??= ((query: string) => ({
    media: query,
    get matches() {
      return evaluate(query);
    },
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver ??= ResizeObserverStub;

  class IntersectionObserverStub {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver ??= IntersectionObserverStub;
}

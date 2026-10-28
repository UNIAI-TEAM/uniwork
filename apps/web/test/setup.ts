// Shared vitest setup for apps/web.
//
// The host suites assert the shared i18n copy, so the shared instance starts
// before any test module evaluates.
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

  // jsdom has no PointerEvent; Base UI builds one when a Radio, Switch or Toggle
  // is clicked (the same shim as packages/views/test/setup.ts).
  if (typeof (globalThis as { PointerEvent?: unknown }).PointerEvent === "undefined") {
    class PointerEventStub extends MouseEvent {
      pointerId = 1;
      pointerType: string;
      isPrimary = true;
      constructor(type: string, init?: PointerEventInit) {
        super(type, init);
        this.pointerType = init?.pointerType ?? "mouse";
      }
    }
    (globalThis as unknown as { PointerEvent: typeof PointerEventStub }).PointerEvent = PointerEventStub;
  }
}

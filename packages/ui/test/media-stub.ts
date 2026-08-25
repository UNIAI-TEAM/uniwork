/**
 * jsdom không cài `matchMedia` lẫn `IntersectionObserver`.
 *
 * Stub này KHÔNG trả về hằng số: nó đọc `window.innerWidth` thật của jsdom
 * (mặc định 1024) để trả lời `(min-width: …)`, nên test thấy đúng cái mà một
 * viewport 1024px sẽ thấy. Chỉnh `window.innerWidth` trong test là media query
 * đổi theo. `(pointer: coarse)` trả false — jsdom không giả lập cảm ứng.
 */
export function installMediaStubs() {
  if (typeof window === "undefined") return;

  const listeners = new Set<() => void>();

  const evaluate = (query: string): boolean => {
    const min = /\(min-width:\s*(\d+)px\)/.exec(query);
    if (min) return window.innerWidth >= Number(min[1]);
    const max = /\(max-width:\s*(\d+)px\)/.exec(query);
    if (max) return window.innerWidth <= Number(max[1]);
    return false;
  };

  window.matchMedia = ((query: string) => {
    const mql = {
      media: query,
      get matches() {
        return evaluate(query);
      },
      onchange: null,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      addListener: (fn: () => void) => listeners.add(fn),
      removeListener: (fn: () => void) => listeners.delete(fn),
      dispatchEvent: () => false,
    };
    return mql as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  class IO {
    constructor(private cb: IntersectionObserverCallback) {}
    observe(target: Element) {
      // jsdom không bố trí layout nên mọi thứ coi như đang hiển thị.
      this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
    }
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver ??= IO;
}

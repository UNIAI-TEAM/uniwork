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
    // Every width condition must hold, so "(min-width: a) and (max-width: b)" is a range, not just its first half.
    const conditions = [...query.matchAll(/\((min|max)-width:\s*(\d+)px\)/g)];
    if (conditions.length === 0) return false;
    return conditions.every(([, bound, px]) =>
      bound === "min" ? window.innerWidth >= Number(px) : window.innerWidth <= Number(px),
    );
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

"use client";
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

/**
 * Đọc giá trị thật của các CSS custom property tại `ref` — dùng cho những nơi
 * KHÔNG nhận được `var()`, điển hình là canvas 2D. Đọc tại element nên mọi scope
 * theme (`.dark` trên subtree) đều ra đúng giá trị, thay vì chép cứng hex.
 *
 * Trả `fallback` ở lần render đầu (và khi SSR); layout effect đọc lại trước khi
 * trình duyệt vẽ nên không có frame nào hiện màu fallback. Theo dõi class trên
 * <html> để đọc lại khi đổi theme.
 */
export function useCssVars<K extends string>(
  ref: RefObject<HTMLElement | null>,
  fallback: Record<K, string>,
): Record<K, string> {
  const [vars, setVars] = useState(fallback);
  // Giữ fallback trong ref: object literal ở call site đổi identity mỗi render,
  // đưa thẳng vào deps sẽ thành vòng lặp vô hạn.
  const fallbackRef = useRef(fallback);
  fallbackRef.current = fallback;

  useIsomorphicLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const read = () => {
      const style = getComputedStyle(el);
      const base = fallbackRef.current;
      const next = {} as Record<K, string>;
      for (const key of Object.keys(base) as K[]) {
        next[key] = style.getPropertyValue(key).trim() || base[key];
      }
      setVars((prev) => {
        const keys = Object.keys(next) as K[];
        return keys.every((k) => prev[k] === next[k]) ? prev : next;
      });
    };

    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, [ref]);

  return vars;
}

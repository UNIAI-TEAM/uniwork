"use client";
import { useCallback, useSyncExternalStore } from "react";

/**
 * Theo dõi một media query. Dùng khi cần KHÔNG render nhánh cây React ở một
 * breakpoint — `hidden`/`display:none` của CSS vẫn mount component và vẫn chạy
 * mọi effect, timer, observer bên trong nó.
 *
 * `useSyncExternalStore` với snapshot phía server luôn là `false`: bản SSR và
 * khung render ĐẦU TIÊN của client khi hydrate đều trả `false`, nên không có
 * hydration mismatch, rồi một effect ngay sau đó đồng bộ về giá trị thật. Ở lần
 * render thuần client (không hydrate) giá trị thật đã có từ khung hình đầu. Vì
 * vậy nhánh được bọc phải là thứ bỏ đi được — không đặt nội dung chính vào đây.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return () => undefined;
      }
      const media = window.matchMedia(query);
      media.addEventListener("change", onChange);
      return () => media.removeEventListener("change", onChange);
    },
    [query],
  );
  const read = useCallback(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches === true;
  }, [query]);
  return useSyncExternalStore(subscribe, read, () => false);
}

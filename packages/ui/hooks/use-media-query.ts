"use client";
import { useEffect, useState } from "react";

/**
 * Theo dõi một media query. Dùng khi cần KHÔNG render nhánh cây React ở một
 * breakpoint — `hidden`/`display:none` của CSS vẫn mount component và vẫn chạy
 * mọi effect, timer, observer bên trong nó.
 *
 * Trả `false` ở render đầu (và khi SSR) rồi chỉnh lại sau khi mount, nên nhánh
 * được bọc phải là thứ bỏ đi được — không đặt nội dung chính vào đây.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

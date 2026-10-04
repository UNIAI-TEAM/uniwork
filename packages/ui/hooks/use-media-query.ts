"use client";
import { useEffect, useState } from "react";

/**
 * Theo dõi một media query. Dùng khi cần KHÔNG render nhánh cây React ở một
 * breakpoint — `hidden`/`display:none` của CSS vẫn mount component và vẫn chạy
 * mọi effect, timer, observer bên trong nó.
 *
 * `matchMedia` được đọc ngay ở render đầu khi có sẵn (không phải `false` rồi
 * mới sửa sau khi mount): một consumer đặt nội dung chính vào nhánh này sẽ
 * không vẽ nhầm chế độ trong khung hình đầu. Khi SSR (`window` vắng) vẫn trả
 * `false` rồi chỉnh lại sau khi mount, nên nhánh được bọc phải là thứ bỏ đi
 * được — không đặt nội dung chính vào đây.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.(query).matches === true,
  );

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(query);
    setMatches(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

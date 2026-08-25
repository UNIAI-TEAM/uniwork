"use client";
import { useEffect, useState } from "react";

/**
 * `true` khi thiết bị trỏ chính là loại thô (chạm/bút). Dùng bề rộng màn hình để
 * đoán cảm ứng là sai: laptop có màn cảm ứng và tablet gắn bàn phím đều tồn tại.
 *
 * Mặc định `false` ở lần render đầu (và khi SSR) nên hành vi desktop là mặc định
 * an toàn; effect chỉnh lại ngay sau khi mount.
 */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(pointer: coarse)");
    setCoarse(mq.matches);
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return coarse;
}

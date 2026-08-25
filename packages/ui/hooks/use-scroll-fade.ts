import { type RefObject, type CSSProperties, useEffect, useState, useCallback } from "react";

export type ScrollFadeAxis = "vertical" | "horizontal";

/** Bề rộng vệt mờ. Một số = cả hai đầu; tách ra khi một đầu KHÔNG được mờ. */
export type ScrollFadeSize = number | { start?: number; end?: number };

/**
 * Returns a dynamic maskImage style based on scroll position.
 * - At start → fade end only
 * - At end → fade start only
 * - In middle → fade both
 * - No overflow → undefined (no mask)
 *
 * Đặt một đầu về 0 khi ở đầu đó có thứ KHÔNG được phép mờ. Mask ăn vào mọi thứ
 * nó phủ, kể cả vòng focus — mà vòng focus bị che là lỗi WCAG 2.4.11, không phải
 * chuyện thẩm mỹ.
 */
export function useScrollFade(
  ref: RefObject<HTMLElement | null>,
  fadeSize: ScrollFadeSize = 32,
  axis: ScrollFadeAxis = "vertical",
): CSSProperties | undefined {
  const startSize = typeof fadeSize === "number" ? fadeSize : (fadeSize.start ?? 0);
  const endSize = typeof fadeSize === "number" ? fadeSize : (fadeSize.end ?? 0);
  const [fade, setFade] = useState<"none" | "start" | "end" | "both">("none");

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;

    const position = axis === "horizontal" ? el.scrollLeft : el.scrollTop;
    const scrollSize = axis === "horizontal" ? el.scrollWidth : el.scrollHeight;
    const clientSize = axis === "horizontal" ? el.clientWidth : el.clientHeight;
    const scrollable = scrollSize - clientSize;

    if (scrollable <= 0) {
      setFade("none");
      return;
    }

    const atStart = position <= 1;
    const atEnd = position >= scrollable - 1;

    if (atStart && atEnd) setFade("none");
    else if (atStart) setFade("end");
    else if (atEnd) setFade("start");
    else setFade("both");
  }, [axis, ref]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let frame = requestAnimationFrame(update);
    // Mọi nguồn kích hoạt đều gộp vào một frame: `update` đọc scrollTop/
    // scrollHeight/clientHeight, tức ép trình duyệt tính layout đồng bộ. Gọi
    // thẳng từ MutationObserver nghĩa là mỗi lần thêm chip email hay hiện dòng
    // lỗi là một lần layout bị ép giữa chừng.
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };

    el.addEventListener("scroll", update, { passive: true });

    // ResizeObserver only fires on the container's own box. When children
    // grow inside a flex/auto-sized parent, the scroll extent can change while
    // the viewport does not — the mask would stay "none" until the user scrolls.
    // Observing each child's box catches that without a subtree MutationObserver
    // that fires on every text edit and attribute flip inside the pane.
    const ro = new ResizeObserver(schedule);
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);

    // Vẫn cần biết khi CON TRỰC TIẾP được thêm/bớt — để đưa chúng vào ResizeObserver.
    const mo = new MutationObserver(() => {
      for (const child of Array.from(el.children)) ro.observe(child);
      schedule();
    });
    mo.observe(el, { childList: true });

    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", update);
      ro.disconnect();
      mo.disconnect();
    };
  }, [ref, update]);

  const fadeStart = (fade === "start" || fade === "both") && startSize > 0;
  const fadeEnd = (fade === "end" || fade === "both") && endSize > 0;
  if (!fadeStart && !fadeEnd) return undefined;

  const start = fadeStart ? `transparent 0%, black ${startSize}px` : "black 0%";
  const end = fadeEnd ? `black calc(100% - ${endSize}px), transparent 100%` : "black 100%";

  const direction = axis === "horizontal" ? "right" : "bottom";
  const gradient = `linear-gradient(to ${direction}, ${start}, ${end})`;

  return {
    maskImage: gradient,
    WebkitMaskImage: gradient,
  };
}

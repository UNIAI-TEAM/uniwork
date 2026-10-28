import { type Page } from "@playwright/test";

interface FocusStopInfo {
  ok: boolean;
  what: string;
}

/**
 * Checks whether the currently focused element on `page` has a visible focus
 * indicator (outline or ancestor/own box-shadow ring). Returns `null` when
 * focus is on `document.body` or Next's dev portal.
 */
export async function checkActiveFocusIndicator(page: Page): Promise<FocusStopInfo | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    // Lớp phủ dev của Next.js không thuộc app.
    if (el.tagName.toLowerCase() === "nextjs-portal") return null;

    // Nhận MỌI cú pháp màu, không riêng `rgb()`. `ring-ring/50` compile thành
    // `color-mix(in oklab, …)` và trình duyệt trả về `oklab(…)`, nên bản cũ
    // chỉ dò `rgb(` báo "không có chỉ báo" trên một vòng ring 3px có thật —
    // mọi `Input` của app đều dùng đúng ring đó. Test không bao giờ Tab tới
    // một ô nhập nào nên chỗ mù này chưa từng lộ ra.
    const COLOR_FN = /(?:rgba?|oklab|oklch|lab|lch|hwb|hsla?|color)\(/;
    const visibleShadow = (n: Element | null) => {
      if (!n) return false;
      const s = getComputedStyle(n).boxShadow;
      return s !== "none" && COLOR_FN.test(s.replace(/rgba\(0, 0, 0, 0\)[^,]*/g, ""));
    };
    const cs = getComputedStyle(el);
    // Viền chỉ tính khi chính element nhìn thấy được — element opacity-0 thì
    // viền của nó cũng trong suốt.
    const ownOutline = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 && cs.opacity !== "0";
    // Ring có thể nằm trên chính element hoặc trên một tổ tiên gần (mẫu
    // `focus-within` của chip). Đi lên vài bậc thay vì đoán đúng một bậc.
    let ring = false;
    let node: HTMLElement | null = el;
    for (let up = 0; up < 3 && node && !ring; up++) {
      ring = visibleShadow(node);
      node = node.parentElement;
    }

    return {
      ok: ownOutline || ring,
      what: `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 24)}"`,
    };
  });
}

/**
 * Checks whether the currently focused element's focus ring or outline has at
 * least a 3:1 contrast ratio against its immediate neighbouring background.
 * Returns a description of the failure when `< 3:1`, or `null` when compliant.
 */
export async function checkActiveFocusRingContrast(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    if (el.tagName.toLowerCase() === "nextjs-portal") return null;

    // Chuẩn hoá MỌI cú pháp màu về rgb bằng chính trình duyệt. Token của app
    // là hex (`--tw-ring-color: #2f5aff`), nên bóc số bằng regex kiểu rgb() sẽ
    // ra `[2, 5]` — vẫn tính được một tỉ số trông hợp lệ, và test xanh giả.
    const probe = document.createElement("span");
    probe.style.display = "none";
    document.body.appendChild(probe);
    const parse = (c: string): number[] => {
      probe.style.color = "";
      probe.style.color = c;
      const resolved = getComputedStyle(probe).color;
      const n = (resolved.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
      return n.length === 3 ? n : [];
    };
    const lum = (rgb: number[]) =>
      rgb
        .map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        })
        .reduce((acc, c, idx) => acc + c * [0.2126, 0.7152, 0.0722][idx]!, 0);
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const opaque = (c: string) => c !== "" && !/rgba\(0, 0, 0, 0\)|transparent/.test(c);
    const backdrop = (n: Element | null): number[] => {
      for (let x = n; x; x = x.parentElement) {
        const bg = getComputedStyle(x).backgroundColor;
        if (opaque(bg)) return parse(bg);
      }
      return [255, 255, 255];
    };

    // Ring có thể nằm trên chính element hoặc trên tổ tiên gần (mẫu
    // `focus-within` của chip) — đi lên vài bậc, giống test ở trên.
    let host: HTMLElement | null = el;
    let ring = "";
    for (let up = 0; up < 3 && host && !ring; up++) {
      const c = getComputedStyle(host).getPropertyValue("--tw-ring-color").trim();
      if (opaque(c)) {
        ring = c;
        break;
      }
      host = host.parentElement;
    }
    const label = `${el.tagName.toLowerCase()} "${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 22)}"`;

    if (ring && host) {
      const cs = getComputedStyle(host);
      const offset = parseFloat(cs.getPropertyValue("--tw-ring-offset-width")) || 0;
      // Có khoảng hở → ring nằm cạnh MÀU HỞ. Không hở → ring dán thẳng vào
      // nền của chính element, và đó là phía dễ trượt nhất.
      const gapColor = parse(cs.getPropertyValue("--tw-ring-offset-color").trim());
      const neighbour = offset > 0 && gapColor.length === 3 ? gapColor : backdrop(host);
      const ringRgb = parse(ring);
      if (ringRgb.length !== 3) {
        probe.remove();
        return `${label} không đọc được màu ring "${ring}"`;
      }
      const r = ratio(ringRgb, neighbour);
      probe.remove();
      return r < 3 ? `${label} ring ${r.toFixed(2)}:1 (offset ${offset}px)` : null;
    }

    const cs = getComputedStyle(el);
    if (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) {
      // `outline-offset` dương → viền nằm trên nền của tổ tiên, không phải nền
      // của chính element.
      const gap = parseFloat(cs.outlineOffset) || 0;
      const neighbour = gap > 0 ? backdrop(el.parentElement) : backdrop(el);
      const r = ratio(parse(cs.outlineColor), neighbour);
      probe.remove();
      return r < 3 ? `${label} outline ${r.toFixed(2)}:1` : null;
    }
    probe.remove();
    return null;
  });
}

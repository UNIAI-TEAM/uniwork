import { type Page } from "@playwright/test";

/**
 * Phép đo tương phản dùng chung cho mọi spec — đo trên trang đã render, không
 * phải đọc token rồi tự tin.
 *
 * Hai lỗi thật mà nó chặn lại, cả hai đều "trông vẫn ổn" trong review:
 *  - `tailwind-merge` nuốt `text-brand-foreground` của nút primary size lg vì nó xếp
 *    `text-body` (cỡ) và `text-brand-foreground` (màu) chung một nhóm → chữ nút CTA rơi
 *    về màu thừa kế, 3.40:1 trên nền brand.
 *  - `border-border` (1.27:1) dùng làm đường bao ô nhập.
 * Không cái nào làm build đỏ. Chỉ có phép đo mới thấy.
 */
/**
 * Đổi theme là đổi CSS variable, và `transition-colors` sẽ NỘI SUY màu trong
 * 150ms. Đọc `getComputedStyle` ngay lúc đó trả về màu đang chạy dở — từng làm
 * test này báo "Bỏ qua 2.44:1" trong khi giá trị token đã đúng.
 */
async function settle(page: Page) {
  await page.evaluate(
    async () =>
      await Promise.all(
        document
          .getAnimations()
          // Animation lặp vô hạn (vd `animate-pulse` trong minh hoạ Welcome) thì
          // `finished` KHÔNG BAO GIỜ resolve — chờ nó là treo cả test.
          .filter((a) => (a.effect?.getTiming().iterations ?? 1) !== Infinity)
          // Cùng lý do, cho thứ hữu hạn nhưng dài vô lý. Mẹo autofill lan truyền
          // trên mạng là `transition: background-color 0s 600000s` — hữu hạn,
          // 166 giờ, và đủ để treo phép đo tới trần timeout. Bất kỳ chuyển động
          // nào dài hơn 5s cũng không phải thứ trang đang chờ để "lắng xuống".
          .filter((a) => {
            const t = a.effect?.getTiming();
            const total = Number(t?.delay ?? 0) + Number(t?.duration ?? 0);
            return !Number.isFinite(total) ? false : total <= 5000;
          })
          .map((a) => a.finished.catch(() => undefined)),
      ),
  );
}

export async function auditText(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    // Gộp màu bằng chính bộ vẽ của trình duyệt, không tự parse chuỗi. Token của
    // app ra `oklab(...)` (từ `bg-brand/5`) và nhiều nền là bán trong suốt — bóc
    // số bằng regex sẽ đọc `oklab(0.99 …)` thành RGB(1,0,0) tức gần như đen, rồi
    // báo lỗi tương phản ở nơi không có lỗi.
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d", { willReadFrequently: true })!;
    ctx.fillStyle = "#123456";
    ctx.fillStyle = "oklab(0.5 0 0)";
    const colorLevel4 = ctx.fillStyle !== "#123456";

    /** Chồng các lớp màu (dưới → trên) lên nền giấy trắng, trả về pixel thật. */
    const flatten = (layers: string[]): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, 1, 1);
      for (const c of layers) {
        ctx.fillStyle = c;
        ctx.fillRect(0, 0, 1, 1);
      }
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    };
    const lum = (c: number[]) =>
      c
        .map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        })
        .reduce((a, x, i) => a + x * [0.2126, 0.7152, 0.0722][i]!, 0);
    const ratio = (a: number[], b: number[]) => {
      const [x, y] = [lum(a), lum(b)];
      return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
    };
    const over = (base: string, c: string): number[] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = c;
      ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0]!, d[1]!, d[2]!];
    };
    /**
     * Đục hay không thì HỎI BỘ VẼ, đừng dò chuỗi. `bg-brand/5` ra
     * `oklab(… / 0.05)` — một biểu thức không khớp `rgba(` nào cả, nên phép thử
     * bằng regex tưởng nó đục và dừng ngay tại chip, bỏ qua nền trang thật.
     */
    const isOpaque = (c: string) => {
      const w = over("#ffffff", c);
      const b = over("#000000", c);
      return w[0] === b[0] && w[1] === b[1] && w[2] === b[2];
    };
    const clear = (c: string) => c === "" || /rgba\(0, 0, 0, 0\)|transparent/.test(c);
    /**
     * Các lớp nền từ element đi lên, tới lớp đục đầu tiên — hoặc tới một nền
     * gradient. Trước đây gradient bị bỏ qua (chỉ đọc `background-color`), nên chữ
     * trắng trên dải CTA xanh–tím bị đo trên nền giấy trắng và báo 1.00:1. Gặp
     * gradient thì trả về các điểm màu của nó; phép đo lấy điểm tệ nhất, vì chữ có
     * thể nằm ở bất kỳ đâu trên dải.
     */
    const solidLayers = (el: Element | null): string[] => {
      const stack: string[] = [];
      for (let n = el; n; n = n.parentElement) {
        const bg = getComputedStyle(n).backgroundColor;
        if (clear(bg)) continue;
        stack.push(bg);
        if (isOpaque(bg)) break;
      }
      return stack.reverse(); // dưới → trên
    };
    /** Mỗi phần tử trả về: một (hoặc mỗi điểm màu gradient) chồng lớp dưới → trên. */
    const bgGrounds = (el: Element | null): string[][] => {
      const above: string[] = [];
      for (let n = el; n; n = n.parentElement) {
        const style = getComputedStyle(n);
        const bg = style.backgroundColor;
        if (!clear(bg)) {
          above.unshift(bg);
          if (isOpaque(bg)) return [above];
        }
        if (style.backgroundImage.includes("gradient(")) {
          const stops = style.backgroundImage.match(/(?:rgba?|oklab|oklch|lab|lch|hsla?|color)\([^()]*\)/g) ?? [];
          // Điểm màu bán trong suốt phải phủ lên nền THẬT phía dưới (vd dark
          // mode), không phải giấy trắng.
          if (stops.length > 0) {
            const below = solidLayers(n.parentElement);
            const ownBg = clear(bg) ? [] : [above.shift()!];
            return stops.map((stop) => [...below, ...ownBg, stop, ...above]);
          }
        }
      }
      return [above];
    };

    const fails: string[] = [];
    let checked = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
      const own = Array.from(el.childNodes)
        .filter((n) => n.nodeType === Node.TEXT_NODE)
        .map((n) => n.textContent ?? "")
        .join("")
        .trim();
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
      const r = el.getBoundingClientRect();
      if (r.width < 4 || r.height < 4) continue; // sr-only bị clip về 1px
      // WCAG 1.4.3 miễn trừ control đang bị vô hiệu hoá.
      if (el.closest('[aria-disabled="true"], :disabled, [data-disabled]')) continue;
      if (el.closest("nextjs-portal")) continue; // lớp phủ dev của Next.js

      const grounds = bgGrounds(el);
      const size = parseFloat(cs.fontSize);
      const weight = Number.parseInt(cs.fontWeight, 10) || 400;
      // "Chữ lớn" theo WCAG: >=24px, hoặc >=18.66px khi in đậm.
      const large = size >= 24 || (size >= 18.66 && weight >= 700);
      const need = large ? 3 : 4.5;
      // màu chữ có alpha thì cũng gộp; trên gradient lấy điểm màu tệ nhất
      const got = Math.min(...grounds.map((back) => ratio(flatten([...back, cs.color]), flatten(back))));
      checked++;
      if (got < need) {
        fails.push(`"${own.slice(0, 26)}" ${got.toFixed(2)}:1 < ${need} (${Math.round(size)}px/${weight})`);
      }
    }
    return { fails, checked, colorLevel4 };
  });
}

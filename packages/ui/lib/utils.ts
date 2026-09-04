import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * Thang cỡ chữ và bảng màu của UniWork, khai báo lại cho tailwind-merge.
 *
 * Không có hai danh sách này, `twMerge` chỉ biết thang mặc định của Tailwind:
 * `text-body` và `text-brand-foreground` đều là `text-*` mang tên lạ, nó xếp chung MỘT
 * nhóm rồi giữ cái đứng sau. Nút primary size lg (`bg-brand text-brand-foreground` +
 * `text-body`) vì thế mất luôn màu chữ và rơi về màu thừa kế của body —
 * #18181b trên #2f5aff, tức 3.40:1, dưới ngưỡng 4.5:1 của WCAG 1.4.3.
 *
 * Lỗi kiểu này không bao giờ báo: class vẫn hợp lệ, build vẫn xanh, chỉ có chữ
 * đổi màu. Danh sách phải bám theo `@theme` trong packages/ui/styles/tokens.css.
 */
const FONT_SIZES = [
  "micro", "caption", "label", "body", "body-lg",
  "title-sm", "title", "title-lg",
  "display-sm", "display",
  "hero-sm", "hero", "hero-lg",
] as const;

/* Mirrors the `--color-*` aliases in packages/ui/styles/tokens.css. */
const COLORS = [
  "background", "foreground", "app-shell", "page-canvas",
  "surface", "surface-foreground", "surface-raised", "surface-hover",
  "surface-selected", "surface-selected-foreground", "surface-border",
  "card", "card-foreground", "popover", "popover-foreground",
  "primary", "primary-foreground", "secondary", "secondary-foreground",
  "accent", "accent-foreground", "muted", "muted-foreground", "faint-foreground",
  "brand", "brand-foreground", "destructive", "success", "warning", "info",
  "border", "input", "ring", "selection", "selection-foreground", "rail",
  "sidebar", "sidebar-foreground", "sidebar-primary", "sidebar-primary-foreground",
  "sidebar-accent", "sidebar-accent-foreground", "sidebar-border", "sidebar-ring",
  "chart-1", "chart-2", "chart-3", "chart-4", "chart-5",
  "chat-sender-1", "chat-sender-2", "chat-sender-3", "chat-sender-4",
  "chat-sender-5", "chat-sender-6", "chat-sender-7", "chat-sender-8",
] as const;

const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: [...FONT_SIZES] }],
      "text-color": [{ text: [...COLORS] }],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Gắn alpha vào một màu token đã resolve. Dành cho canvas/WebGL — nơi không
 * dùng được `var()` lẫn class opacity của Tailwind. Hex 3/6 số → rgba(); mọi
 * cú pháp khác (rgb/hsl/oklch) trả nguyên vẹn vì canvas tự hiểu, còn ghép alpha
 * cho chúng đòi parse đầy đủ mà không đáng.
 */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const h = m[1]!;
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges tailwind classes with later value winning", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("drops falsy values", () => {
    // `enabled` is a variable rather than a literal `false` so this reads as
    // the real call site — a conditional class — instead of a constant
    // expression the linter is right to reject.
    const enabled = false as boolean;
    expect(cn("a", enabled && "b", undefined, "c")).toBe("a c");
  });
});

/**
 * `cn` phải phân biệt được CỠ CHỮ với MÀU CHỮ trong thang token riêng của
 * UniWork. Cấu hình mặc định của tailwind-merge gộp chúng làm một và âm thầm bỏ
 * bớt — nút primary size lg từng mất `text-brand-foreground` đúng theo cách đó, và
 * không có tín hiệu nào ngoài chính màu chữ.
 */
describe("cn: cỡ chữ và màu chữ là hai nhóm khác nhau", () => {
  it("giữ cả màu lẫn cỡ khi chúng đi cùng nhau", () => {
    const out = cn("bg-brand text-brand-foreground", "text-body");
    expect(out).toContain("text-brand-foreground");
    expect(out).toContain("text-body");
  });

  it("vẫn ghi đè trong CÙNG một nhóm", () => {
    expect(cn("text-body", "text-title")).toBe("text-title");
    expect(cn("text-primary", "text-muted-foreground")).toBe("text-muted-foreground");
  });

  it("không đụng tới thang mặc định của Tailwind", () => {
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("nút primary size lg giữ được màu chữ", () => {
    // Đúng thứ tự thật: base + variant + size, rồi className của call site.
    const out = cn("bg-brand text-brand-foreground hover:opacity-90 h-10 px-4 text-body", "w-full");
    expect(out).toContain("text-brand-foreground");
  });
});

describe("cn() keeps token colours apart from Tailwind's own, on every colour property", () => {
  // The Button base class carries `border-transparent`; a variant overrides
  // it with a token colour and relies on cn() to drop the base value —
  // Tailwind orders both utilities alphabetically in the CSS, so if both
  // survive `border-transparent` wins and an outline button loses its edge.
  // That is exactly what happens to anyone who takes `buttonVariants()`
  // raw (cva concatenates, it does not merge): wrap it in cn().
  it.each([
    ["border-transparent", "border-input"],
    ["border-border", "border-input"],
    ["bg-transparent", "bg-input/30"],
    ["ring-transparent", "ring-ring/50"],
    ["outline-transparent", "outline-brand"],
  ])("%s then %s → only the token survives", (base, token) => {
    expect(cn(base, token)).toBe(token);
  });

  it("still keeps colour and width apart on borders", () => {
    expect(cn("border-2 border-input")).toBe("border-2 border-input");
  });
});

import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("merges tailwind classes with later value winning", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
  });
  it("drops falsy values", () => {
    expect(cn("a", false && "b", undefined, "c")).toBe("a c");
  });
});

/**
 * `cn` phải phân biệt được CỠ CHỮ với MÀU CHỮ trong thang token riêng của
 * UniWork. Cấu hình mặc định của tailwind-merge gộp chúng làm một và âm thầm bỏ
 * bớt — nút primary size lg từng mất `text-on-brand` đúng theo cách đó, và
 * không có tín hiệu nào ngoài chính màu chữ.
 */
describe("cn: cỡ chữ và màu chữ là hai nhóm khác nhau", () => {
  it("giữ cả màu lẫn cỡ khi chúng đi cùng nhau", () => {
    const out = cn("bg-brand text-on-brand", "text-body");
    expect(out).toContain("text-on-brand");
    expect(out).toContain("text-body");
  });

  it("vẫn ghi đè trong CÙNG một nhóm", () => {
    expect(cn("text-body", "text-title")).toBe("text-title");
    expect(cn("text-primary", "text-secondary")).toBe("text-secondary");
  });

  it("không đụng tới thang mặc định của Tailwind", () => {
    expect(cn("text-sm", "text-lg")).toBe("text-lg");
  });

  it("nút primary size lg giữ được màu chữ", () => {
    // Đúng thứ tự thật: base + variant + size, rồi className của call site.
    const out = cn("bg-brand text-on-brand hover:opacity-90 h-10 px-4 text-body", "w-full");
    expect(out).toContain("text-on-brand");
  });
});

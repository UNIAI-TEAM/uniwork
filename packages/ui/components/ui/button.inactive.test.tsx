import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Button } from "./button";

/**
 * `aria-disabled` là cách khoá nút mà KHÔNG đẩy nó ra khỏi thứ tự Tab — dùng ở
 * những chỗ dòng chữ giải thích "vì sao chưa bấm được" chỉ tới được người dùng
 * bàn phím nếu họ dừng chân ở nút. Đổi lại, việc chặn hành động không còn do
 * trình duyệt lo, nên nó phải được khoá bằng test.
 */
describe("Button aria-disabled", () => {
  it("vẫn nhận được tiêu điểm", () => {
    render(<Button aria-disabled>Tiếp tục</Button>);
    const btn = screen.getByRole("button", { name: "Tiếp tục" });
    btn.focus();
    expect(document.activeElement).toBe(btn);
    expect(btn).not.toBeDisabled();
  });

  it("nhưng không chạy onClick", () => {
    const onClick = vi.fn();
    render(
      <Button aria-disabled onClick={onClick}>
        Tiếp tục
      </Button>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("khi bật lại thì onClick chạy bình thường", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Tiếp tục</Button>);
    fireEvent.click(screen.getByRole("button", { name: "Tiếp tục" }));
    expect(onClick).toHaveBeenCalledOnce();
  });
});

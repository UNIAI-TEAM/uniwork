import { expect } from "vitest";

/**
 * Hợp đồng của một nút "chưa bấm được" trong onboarding.
 *
 * KHÔNG dùng thuộc tính `disabled`: nó gỡ nút khỏi thứ tự Tab, nên người dùng
 * bàn phím đi hết bước mà không bao giờ dừng ở CTA, và không bao giờ nghe được
 * dòng hint nói còn thiếu gì. Ba điều kiện dưới đây phải đúng CÙNG LÚC — thiếu
 * cái thứ ba thì nút "nhìn như khoá" nhưng vẫn chạy hành động.
 */
export function expectInactive(el: HTMLElement) {
  expect(el).toHaveAttribute("aria-disabled", "true");
  expect(el).not.toBeDisabled(); // vẫn nhận được tiêu điểm
  expect(el).toHaveAttribute("aria-describedby"); // vẫn nói được lý do
}

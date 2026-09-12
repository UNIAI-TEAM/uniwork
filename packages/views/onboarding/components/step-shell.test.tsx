import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../../test/api-mock";
import { StepFooter, StepShell, STEP_HINT_ID } from "./step-shell";

initI18n();

/**
 * jsdom không dựng layout nên không đo được khoảng trống; cái chốt được ở đây là
 * nguyên nhân. Chân trang từng mang `mt-auto` trong một cột `min-h-full`, nên ở
 * 1440×900 nó cách ô cuối của biểu mẫu 267–355px tuỳ bước. Chỗ thừa giờ chia đều
 * hai đầu bằng `my-auto` ở shell, và chân trang bám ngay dưới nội dung.
 */
describe("StepShell layout", () => {
  it("keeps the step's actions attached to the content instead of pinning them to the bottom", () => {
    render(
      wrapWithNav(
        <StepShell currentStep="workspace">
          <div data-testid="content">nội dung</div>
          <StepFooter hint="gợi ý">
            <button type="button">Tiếp tục</button>
          </StepFooter>
        </StepShell>,
      ),
    );
    const footer = document.getElementById(STEP_HINT_ID)!.parentElement!;
    expect(footer.className).not.toMatch(/\bmt-auto\b/);
  });

  /**
   * `my-auto` chứ không phải `justify-center`: lề auto co về 0 khi nội dung cao
   * hơn khung, còn `justify-center` trong vùng `overflow-y-auto` sẽ cắt mất phần
   * đầu của bước dài và không cuộn tới được.
   */
  it("centres the step block with auto margins, never with justify-center", () => {
    const { container } = render(
      wrapWithNav(
        <StepShell currentStep="workspace">
          <div data-testid="content">nội dung</div>
        </StepShell>,
      ),
    );
    const wrapper = screen.getByTestId("content").parentElement!;
    expect(wrapper.className).toMatch(/\bmy-auto\b/);
    const main = container.querySelector("main")!;
    expect(main.className).not.toMatch(/justify-center/);
    expect(main.firstElementChild!.className).not.toMatch(/justify-center/);
  });
});

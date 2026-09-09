import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";

/**
 * Trang công khai là màn hình duy nhất người chưa đăng nhập nhìn thấy, và
 * trước spec này nó không có phép đo nào. Ba thứ được giữ ở đây:
 *
 *  - Dải tin cậy và khối FAQ thực sự hiện ra (không chỉ compile được).
 *  - Hai trang giải pháp mở được từ trang chủ và không 404.
 *  - Tương phản chữ đạt AA ở CẢ hai chế độ. Dải tin cậy là block mới duy nhất
 *    đặt chữ phụ trên nền `surface`, đúng chỗ token dễ trượt nhất.
 */
test.describe("landing", () => {
  test("dải tin cậy, FAQ và hai trang giải pháp", async ({ page }) => {
    await page.goto("/");
    // Trang công khai nằm trong `Providers` của ứng dụng, nên khi tải nó vẫn
    // gọi POST /auth/refresh và GET /config. Lúc hai request đó xong, React
    // dựng lại nhánh cây và mọi node đang được giữ đều bị gỡ khỏi DOM — click
    // vào accordion trước thời điểm này sẽ trượt. Đây là hệ quả của việc hoàn
    // tác nhóm route (app); nếu landing lại có runtime riêng, bỏ dòng này đi.
    await page.waitForLoadState("networkidle");

    // Dải tin cậy: ba mô hình được nêu tên và ba cam kết.
    await expect(page.getByText("Chạy trên mô hình bạn chọn")).toBeVisible();
    await expect(page.getByText("Ollama (tự vận hành)")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Dữ liệu đặt tại Việt Nam" })).toBeVisible();

    // Section nêu vấn đề đứng trước lưới năng lực.
    await expect(
      page.getByRole("heading", { name: "Công việc của một đội đang nằm ở bốn nơi khác nhau" }),
    ).toBeVisible();

    // FAQ: accordion đóng lúc đầu, mở ra mới thấy câu trả lời.
    const question = page.getByRole("button", { name: "Dữ liệu của chúng tôi nằm ở đâu?" });
    await question.scrollIntoViewIfNeeded();
    await expect(page.getByText("Trên hạ tầng đặt tại Việt Nam", { exact: false })).toBeHidden();
    await question.click();
    await expect(page.getByText("Trên hạ tầng đặt tại Việt Nam", { exact: false })).toBeVisible();

    // Từ khối giải pháp sang trang phòng ban, rồi quay lại.
    await page.getByRole("link", { name: /Nhóm sản phẩm/ }).first().click();
    await expect(page).toHaveURL(/\/solutions\/product$/);
    await expect(
      page.getByRole("heading", { name: "Từ cuộc họp tới việc đã giao, không mất gì ở giữa" }),
    ).toBeVisible();

    await page.goto("/solutions/operations");
    await expect(
      page.getByRole("heading", { name: "Quy trình chạy được là quy trình truy được" }),
    ).toBeVisible();
    // Header trên trang con trỏ về mỏ neo của trang chủ, không phải một mỏ neo
    // trống trong chính tài liệu này.
    await expect(page.getByRole("link", { name: "Tính năng" }).first()).toHaveAttribute(
      "href",
      "/#platform",
    );
  });

  for (const mode of ["light", "dark"] as const) {
    test(`tương phản chữ đạt WCAG AA — ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);

      const home = await auditText(page);
      expect(home.colorLevel4, "trình duyệt không nhận CSS Color 4 trong canvas — phép đo sẽ sai âm thầm").toBe(
        true,
      );
      expect(home.checked, "không đo được node chữ nào — selector đã trượt").toBeGreaterThan(15);
      expect(home.fails, `trang chủ (${mode}): ${home.fails.join(" | ")}`).toEqual([]);

      await page.goto("/solutions/product");
      await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
      const solution = await auditText(page);
      expect(solution.fails, `trang giải pháp (${mode}): ${solution.fails.join(" | ")}`).toEqual([]);
    });
  }
});

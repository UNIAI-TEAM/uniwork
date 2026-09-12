import { expect, test, type Page } from "@playwright/test";
import { auditText } from "./contrast";

/**
 * Mọi section dưới màn hình đầu vào trang ở `opacity: 0` cho tới khi
 * ScrollTrigger của nó chạy, và `auditText` bỏ qua node opacity 0. Đo mà không
 * cuộn thì bỏ sót đúng chỗ dễ sai nhất: dải meetings nằm trên nền đảo màu.
 * Cuộn hết một lượt rồi quay lại đầu trang trước khi đo.
 */
async function revealEverything(page: Page) {
  await page.evaluate(async () => {
    const height = document.documentElement.scrollHeight;
    for (let y = 0; y < height; y += 600) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 60));
    }
    window.scrollTo(0, 0);
  });
  await expect
    .poll(async () =>
      page.evaluate(
        () =>
          [...document.querySelectorAll("body *")].filter(
            (el) =>
              [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent?.trim()) &&
              getComputedStyle(el).opacity === "0",
          ).length,
      ),
    )
    .toBe(0);
}

/**
 * Trang công khai là màn hình duy nhất người chưa đăng nhập nhìn thấy, và
 * trước spec này nó không có phép đo nào. Ba thứ được giữ ở đây:
 *
 *  - Dải tin cậy và khối FAQ thực sự hiện ra (không chỉ compile được).
 *  - Hai trang giải pháp mở được từ trang chủ và không 404.
 *  - Mỗi request nhận đúng ngôn ngữ của chính nó, không phải của khách trước.
 *  - Nút chuyển ngữ và nút chế độ sáng tối trên header đổi thật và nhớ được
 *    lựa chọn qua một lần tải lại — đây là hai thứ duy nhất người chưa đăng
 *    nhập chỉnh được, và cả hai chỉ có giá trị nếu nó bền hơn một lần xem.
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

    // Work Products: tiêu đề, luận điểm và dòng thời gian đều có mặt.
    const wp = page.getByRole("heading", { name: "Từ bối cảnh công việc đến kết quả thực tế" });
    await wp.scrollIntoViewIfNeeded();
    await expect(wp).toBeVisible();
    await expect(page.getByText("Chúng ta không làm một Microsoft Office mới")).toBeVisible();
    await expect(page.getByText("Đây là kế hoạch nội bộ, không phải cam kết phát hành.")).toBeVisible();

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

    // Khối khoảng trống thị trường dẫn sang trang phân tích, và trang đó mở được.
    await page.goto("/");
    await page.waitForLoadState("networkidle");
    const gap = page.getByRole("link", { name: "Đọc phân tích đầy đủ" });
    await gap.scrollIntoViewIfNeeded();
    await gap.click();
    await expect(page).toHaveURL(/\/why-uniwork$/);
    await expect(
      page.getByRole("heading", { name: "Những vấn đề lớn của các nền tảng hiện tại" }),
    ).toBeVisible();
    // Bốn nền tảng đều được nêu tên, không nền tảng nào bị bỏ rơi khi copy đổi.
    for (const name of ["Microsoft 365", "Notion", "ClickUp", "Coda"]) {
      await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
    }
  });

  test("đổi ngôn ngữ và chế độ sáng tối ngay trên header", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("networkidle");

    // Tên nút cũng là một câu trong FAQ, nên hai control này được lấy trong
    // header chứ không trên cả trang.
    const header = page.getByRole("banner");

    // Ngôn ngữ: nhãn nút vẫn là tiếng Việt lúc này, vì đó là ngôn ngữ đang bật.
    await header.getByRole("button", { name: "Ngôn ngữ", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "English" }).click();
    await expect(header.getByRole("link", { name: "Features" })).toBeVisible();
    // Lựa chọn phải sống qua một lần tải lại, nếu không nó chỉ là hiệu ứng.
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await page.reload();
    await expect(header.getByRole("link", { name: "Features" })).toBeVisible();

    // Chế độ sáng tối: nhãn bây giờ là tiếng Anh, theo đúng lựa chọn ở trên.
    await header.getByRole("button", { name: "Theme", exact: true }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(page.locator("html")).toHaveClass(/dark/);
    await page.reload();
    await expect(page.locator("html")).toHaveClass(/dark/);
  });

  /**
   * i18next là singleton của cả tiến trình, còn `changeLanguage` thì bất đồng
   * bộ. Cách mắc trước đây gọi nó trong lúc render mà không chờ, nên ngôn ngữ
   * chỉ kịp đổi cho request KẾ TIẾP: mỗi khách nhận đúng ngôn ngữ của khách
   * trước, dưới một `<html lang>` nói khác. Sáu request xen kẽ là đủ tái hiện,
   * và đo bằng HTML thô vì lỗi nằm ở phía máy chủ — trình duyệt sửa lại lúc
   * hydrate, che mất nó.
   */
  test("mỗi request nhận đúng ngôn ngữ của chính nó", async ({ playwright, baseURL }) => {
    const expected = { vi: "Tính năng", en: "Features" } as const;
    // Context riêng cho từng request, KHÔNG dùng `page.request`: page mang sẵn
    // cookie jar của mình và nó đè lên header đặt tay, nên bài đo tưởng là
    // xen kẽ mà thật ra chỉ hỏi một ngôn ngữ.
    for (const locale of ["vi", "en", "vi", "en", "vi", "en"] as const) {
      const ctx = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { Cookie: `uniwork-locale=${locale}` },
      });
      const html = await (await ctx.get("/")).text();
      await ctx.dispose();
      // Đọc đúng chữ đã render, không phải `html.includes(...)`: từ điển tiếng
      // Anh đi kèm trong payload của máy chủ, nên cả trang tiếng Việt cũng
      // chứa chuỗi "Features" và phép thử cả tài liệu luôn xanh.
      const lang = html.match(/<html lang="([a-z]+)"/)?.[1];
      const nav = html.match(/href="\/#platform"[^>]*>([^<]*)/)?.[1];
      expect(lang, "sai <html lang>").toBe(locale);
      expect(nav, `cookie ${locale} nhưng máy chủ render "${nav}"`).toBe(expected[locale]);
    }
  });

  for (const mode of ["light", "dark"] as const) {
    test(`tương phản chữ đạt WCAG AA — ${mode}`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto("/");
      await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
      await revealEverything(page);

      const home = await auditText(page);
      expect(home.colorLevel4, "trình duyệt không nhận CSS Color 4 trong canvas — phép đo sẽ sai âm thầm").toBe(
        true,
      );
      expect(home.checked, "không đo được node chữ nào — selector đã trượt").toBeGreaterThan(150);
      expect(home.fails, `trang chủ (${mode}): ${home.fails.join(" | ")}`).toEqual([]);

      await page.goto("/solutions/product");
      await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
      const solution = await auditText(page);
      expect(solution.fails, `trang giải pháp (${mode}): ${solution.fails.join(" | ")}`).toEqual([]);

      await page.goto("/why-uniwork");
      await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
      await revealEverything(page);
      const why = await auditText(page);
      expect(why.fails, `trang vì sao (${mode}): ${why.fails.join(" | ")}`).toEqual([]);
    });
  }
});

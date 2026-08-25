import { expect, test, type Page } from "@playwright/test";

/**
 * Dưới `md`, onboarding là một CÂY RENDER KHÁC: rail biến mất, StepProgressBar
 * thay vai trò của nó, dot-sphere không mount. Trước đây toàn bộ e2e chạy ở
 * 1440×900, nghĩa là nửa còn lại của giao diện chưa từng được chạy thử lần nào.
 */
test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

async function reachAboutYou(page: Page) {
  const stamp = Date.now();
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Mobile");
  await page.getByLabel("Email").fill(`mobile-${stamp}@example.com`);
  await page.getByLabel("Mật khẩu").fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByText("Cho chúng tôi biết đôi chút về bạn.").waitFor();
}

test("không có thanh cuộn ngang ở bất kỳ bước nào", async ({ page }) => {
  await reachAboutYou(page);
  const overflow = async (label: string) => {
    const w = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    expect(w.doc, `${label}: tràn ngang ${w.doc}px > ${w.win}px`).toBeLessThanOrEqual(w.win + 1);
  };
  await overflow("về bạn");

  await page.getByRole("radio", { name: "Kỹ sư / phát triển" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByRole("heading", { name: "Đặt tên tổ chức của bạn." }).waitFor();
  await overflow("tổ chức");
});

test("rail ẩn, thanh tiến độ nói được vị trí bước", async ({ page }) => {
  await reachAboutYou(page);
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.getByText(/Bước 1 trên 4/)).toBeAttached();
  // Canvas trang trí không được mount dưới md — nó chạy rAF 60fps để vẽ 0×0.
  await expect(page.locator('[data-slot="dot-sphere"]')).toHaveCount(0);
});

test("mọi vùng chạm đạt 44px", async ({ page }) => {
  await reachAboutYou(page);
  // Nhóm nhiều-lựa-chọn: chọn "Khác" để dựng cả ô nhập tự do lẫn nút bỏ chọn.
  await page.getByRole("checkbox", { name: "Khác" }).click();

  const result = await page.evaluate(() => {
    const seen = new Set<Element>();
    const rows: Array<{ label: string; w: number; h: number }> = [];
    const targets = document.querySelectorAll<HTMLElement>(
      'button, a[href], input:not([type="hidden"]), [role="radio"], [role="checkbox"]',
    );
    for (const el of Array.from(targets)) {
      // Ô nhập KHÔNG tự vẽ viền chỉ là control ẩn bên trong một khung lớn hơn
      // (radio trong suốt phủ chip, ô slug trong pill, ô nháp trong khung chip
      // email). Vùng chạm thật là cái khung — đo cái đó, đừng bỏ qua.
      //
      // `[data-slot]` là khung do CHÍNH component khai báo, không phải suy đoán
      // từ cây DOM: chip "Khác" đặt control absolute so với <div> bọc ngoài chứ
      // không so với <label> bên trong, nên `closest("label")` ra đúng cái nhãn
      // 16×16 của mỗi biểu tượng.
      const bare = el.tagName === "INPUT" && parseFloat(getComputedStyle(el).borderTopWidth) === 0;
      const target = bare
        ? (el.closest<HTMLElement>("[data-slot]") ?? el.closest("label") ?? el.parentElement ?? el)
        : el;
      if (seen.has(target)) continue;
      seen.add(target);
      const r = target.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue; // ẩn
      const name = (el.getAttribute("aria-label") ?? target.textContent ?? "").trim().slice(0, 20);
      rows.push({ label: `${target.tagName.toLowerCase()}"${name}"`, w: Math.round(r.width), h: Math.round(r.height) });
    }
    return rows;
  });

  // Chống test rỗng: nếu selector trượt hết thì mảng rỗng cũng "đạt".
  expect(result.length, "không tìm thấy vùng chạm nào để đo").toBeGreaterThan(8);
  const small = result.filter((r) => r.w < 44 || r.h < 44);
  expect(small, `vùng chạm dưới 44px: ${small.map((r) => `${r.label} ${r.w}×${r.h}`).join(", ")}`).toEqual([]);
});

test("CTA chính không bị vệt mờ của vùng cuộn ăn vào", async ({ page }) => {
  await reachAboutYou(page);

  const main = page.locator("main");
  const overflows = await main.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  expect(overflows, "bước này không tràn ở 375×667 nên phép thử vô nghĩa").toBe(true);

  // Ở đỉnh vùng cuộn chưa có mask nào; vệt mờ đầu trên chỉ xuất hiện sau khi
  // cuộn. Phải cuộn rồi mới đo, nếu không test luôn xanh mà chẳng kiểm tra gì.
  await main.evaluate((el) => el.scrollBy(0, 120));
  await expect
    .poll(async () => main.evaluate((el) => getComputedStyle(el).maskImage))
    .not.toBe("none");

  const mask = await main.evaluate((el) => getComputedStyle(el).maskImage);
  // Đầu trên mờ dần là đúng; đáy — nơi đặt CTA và vòng focus của nó — phải đục.
  // `getComputedStyle` chuẩn hoá `transparent` thành `rgba(0, 0, 0, 0)`.
  const CLEAR = String.raw`(?:transparent|rgba\(0, 0, 0, 0\))`;
  expect(mask, `mask thiếu vệt mờ đầu trên: ${mask}`).toMatch(new RegExp(`${CLEAR} 0(?:%|px)`));
  expect(mask, `mask làm mờ đáy vùng cuộn, nơi đặt CTA: ${mask}`).not.toMatch(new RegExp(`${CLEAR} 100%`));

  // Và nút thật sự đục: mask ăn theo pixel, nên đo trên chính CTA.
  const cta = page.getByRole("button", { name: "Tiếp tục" });
  await cta.focus();
  await expect(cta).toBeInViewport();
});

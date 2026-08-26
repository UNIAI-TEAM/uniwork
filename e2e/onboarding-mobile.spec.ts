import { expect, test, type Page } from "@playwright/test";
import { reachStep, walkOnboarding } from "./onboarding-nav";

/**
 * Dưới `md`, onboarding là một CÂY RENDER KHÁC: rail biến mất, StepProgressBar
 * thay vai trò của nó, dot-sphere không mount. Trước đây toàn bộ e2e chạy ở
 * 1440×900, nghĩa là nửa còn lại của giao diện chưa từng được chạy thử lần nào.
 */
test.use({ viewport: { width: 375, height: 667 }, hasTouch: true, isMobile: true });

test("không có thanh cuộn ngang ở bất kỳ bước nào", async ({ page }) => {
  const over: string[] = [];
  await walkOnboarding(page, "Mobile", async (step) => {
    const w = await page.evaluate(() => ({
      doc: document.documentElement.scrollWidth,
      win: window.innerWidth,
    }));
    if (w.doc > w.win + 1) over.push(`${step}: ${w.doc}px > ${w.win}px`);
  });
  expect(over, `tràn ngang: ${over.join(" | ")}`).toEqual([]);
});

test("rail ẩn, thanh tiến độ nói được vị trí bước", async ({ page }) => {
  await reachStep(page, "about_you", "Mobile");
  await expect(page.locator("aside")).toBeHidden();
  await expect(page.getByText(/Bước 1 trên 4/)).toBeAttached();
  // Canvas trang trí không được mount dưới md — nó chạy rAF 60fps để vẽ 0×0.
  await expect(page.locator('[data-slot="dot-sphere"]')).toHaveCount(0);
});

test("mọi vùng chạm đạt 44px ở mọi bước", async ({ page }) => {
  const small: string[] = [];
  await walkOnboarding(page, "Touch", async (step) => {
  // Nhóm nhiều-lựa-chọn: chọn "Khác" để dựng cả ô nhập tự do lẫn nút bỏ chọn.
  if (step === "about_you") await page.getByRole("checkbox", { name: "Khác" }).click();

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
      //
      // Bắt đầu từ CHA, không từ chính element: `closest()` tính cả chính nó, mà
      // primitive `Input` cũng mang `data-slot="input"` — nên nhánh này luôn trả
      // về đúng cái input vừa bị loại, và cái khung nó cần đo (pill slug, khung
      // chip email) chưa từng được nhìn tới lần nào.
      const bare = el.tagName === "INPUT" && parseFloat(getComputedStyle(el).borderTopWidth) === 0;
      const target = bare
        ? (el.parentElement?.closest<HTMLElement>("[data-slot]") ?? el.closest("label") ?? el.parentElement ?? el)
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

  // Chống test rỗng: nếu selector trượt hết thì mảng rỗng cũng "đạt". Số đếm
  // theo từng bước — bước "Về bạn" có 18 control, bước Tổ chức chỉ có 5, nên
  // một ngưỡng chung hoặc là vô dụng ở bước này hoặc là đỏ giả ở bước kia.
  const floor = { about_you: 15, organization: 5, workspace: 6, invite: 7 }[step];
  expect(result.length, `${step}: chỉ tìm thấy ${result.length} vùng chạm, selector đã trượt`).toBeGreaterThanOrEqual(floor);
  for (const r of result) if (r.w < 44 || r.h < 44) small.push(`${step}: ${r.label} ${r.w}×${r.h}`);
  });

  expect(small, `vùng chạm dưới 44px: ${small.join(", ")}`).toEqual([]);
});

test("CTA chính không bị vệt mờ của vùng cuộn ăn vào", async ({ page }) => {
  await reachStep(page, "about_you", "Mobile");

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

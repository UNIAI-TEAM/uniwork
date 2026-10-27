import { expect, test } from "@playwright/test";
import { checkActiveFocusIndicator, checkActiveFocusRingContrast } from "./focus";
import { reachStep, walkOnboarding } from "./onboarding-nav";

test.use({ viewport: { width: 1440, height: 900 } });


/**
 * Điều hướng bằng bàn phím hỏng âm thầm: giao diện vẫn đúng bằng mắt trong khi
 * người dùng bàn phím mất dấu mình đang ở đâu. Hai lỗi từng có thật mà test này
 * chặn lại: viền focus toàn cục nằm ngoài cascade layer nên đè mọi
 * `focus:outline-none` và sinh ring đôi; và control trong suốt phủ chip khiến
 * chỉ báo focus rơi lên một element opacity-0.
 */
test("mọi điểm dừng Tab đều có chỉ báo focus nhìn thấy được — cả 4 bước", async ({ page }) => {
  const bare: string[] = [];
  await walkOnboarding(page, "Focus", async (step) => {
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const info = await checkActiveFocusIndicator(page);
    if (info && !info.ok) bare.push(`${step}: ${info.what}`);
  }
  });

  expect(bare, `điểm dừng Tab không có chỉ báo focus: ${bare.join(", ")}`).toEqual([]);
});

test("chỉ có MỘT chỉ báo focus, không lồng hai vòng", async ({ page }) => {
  await reachStep(page, "about_you", "Focus");
  await page.getByRole("radio", { name: "Khác" }).first().click();

  const free = page.getByRole("textbox").first();
  await free.focus();
  const doubled = await free.evaluate((el) => {
    const cs = getComputedStyle(el);
    return cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0;
  });
  // Chip vẽ ring bằng `focus-within`; ô nhập bên trong không được vẽ thêm viền.
  expect(doubled, "ô nhập tự do vẽ viền riêng chồng lên ring của chip").toBe(false);
});

/**
 * Chỉ báo focus CÓ MẶT chưa đủ — nó còn phải phân biệt được với thứ nó đang chỉ.
 * Lỗi thật đã xảy ra: ring `brand` vẽ sát nút nền `brand` (1.00:1). Test "có
 * box-shadow" ở trên vẫn xanh, trong khi bằng mắt nút chỉ to thêm 2px.
 *
 * Phải đo TẠI ĐIỂM DỪNG TAB THẬT: `--tw-ring-color` chỉ tồn tại trong khối
 * `:focus-visible`, đọc nó trên một nút không có tiêu điểm luôn ra chuỗi rỗng —
 * và test sẽ xanh mà chẳng kiểm tra gì.
 */
test("vòng focus tách được khỏi nền ngay sát nó (>= 3:1) — cả 4 bước", async ({ page }) => {
  const offenders: string[] = [];
  await walkOnboarding(page, "Ring", async (step) => {
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    const bad = await checkActiveFocusRingContrast(page);
    if (bad) offenders.push(`${step}: ${bad}`);
  }
  });

  expect(offenders, `chỉ báo focus không tách khỏi nền sát nó: ${offenders.join(" | ")}`).toEqual([]);
});

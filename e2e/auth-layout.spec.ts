import { expect, test } from "@playwright/test";

/**
 * Hình học của màn tín thư, đo trên trang đã render.
 *
 * Lỗi thật file này chặn: rail từng có bề rộng CỐ ĐỊNH 352px bê từ onboarding
 * sang. Onboarding chịu được vì cột phải của nó dày (option card, stepper);
 * login chỉ có ba phần tử. Ở 1907px rail tụt xuống 18% màn hình và cột form
 * 448px trôi giữa 1555px trống — 554px mỗi bên, rộng hơn chính cột form. Không
 * test nào đỏ vì chuyện đó, và trên máy 1440px của người sửa thì nó "trông ổn".
 */
// Hai đầu của dải là đủ: rail nay tính theo phần trăm, nên nếu nó đúng ở 1280
// và 1920 thì nó đúng ở giữa. Bốn bề rộng chỉ nạp lại trang thêm hai lần cho
// mỗi test và bóp thời gian của những spec chạy song song.
const WIDE = [1920, 1280] as const;

for (const route of ["/login", "/register"] as const) {
  test(`rail giữ tỉ lệ, cột form không trôi — ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.getByLabel("Mật khẩu", { exact: true }).waitFor();

    for (const width of WIDE) {
      // Đổi kích thước chứ không nạp lại: bố cục là CSS thuần, và mỗi lần
      // `goto` là một lần nữa bắt dev server phục vụ cả route.
      await page.setViewportSize({ width, height: 900 });

      const m = await page.evaluate(() => {
        const rail = document.querySelector("aside")!.getBoundingClientRect();
        const column = document.querySelector("main > div")!.getBoundingClientRect();
        return {
          vw: window.innerWidth,
          railW: rail.width,
          colX: column.x,
          colW: column.width,
        };
      });

      const share = m.railW / m.vw;
      expect(share, `${route} @${width}px: rail chiếm ${(share * 100).toFixed(0)}% màn hình`).toBeGreaterThan(0.3);
      expect(share, `${route} @${width}px: rail chiếm ${(share * 100).toFixed(0)}% màn hình`).toBeLessThan(0.5);

      // Khoảng trống giữa rail và cột form không được rộng hơn chính cột form —
      // quá ngưỡng đó thì hai khối đọc thành hai vật thể rời nhau, không phải
      // một bố cục chia đôi.
      const gutter = m.colX - m.railW;
      expect(gutter, `${route} @${width}px: trống ${Math.round(gutter)}px vs cột ${Math.round(m.colW)}px`).toBeLessThanOrEqual(m.colW);
    }
  });
}

test("tiêu đề dẫn được trang ở desktop, và nút hiện mật khẩu đủ lớn cho chuột", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByLabel("Mật khẩu", { exact: true }).waitFor();

  const h1 = await page
    .locator("h1")
    .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize));
  expect(h1, `h1 ${h1}px — màn duy nhất người chưa đăng nhập thấy`).toBeGreaterThanOrEqual(24);

  const eye = (await page.getByRole("button", { name: "Hiện mật khẩu" }).boundingBox())!;
  expect(Math.min(eye.width, eye.height), `nút mắt ${eye.width}x${eye.height}`).toBeGreaterThanOrEqual(32);
});

/**
 * `base.css` nằm ngoài `@layer base` ở chỗ này là CHỦ Ý, nhưng cũng là chỗ dễ
 * mất nhất: một lần dọn dẹp kéo khối autofill vào layer là Tailwind utility
 * thắng lại và ô autofill trở về màu xanh mặc định của Chrome. Test file CSS
 * không thấy được điều đó — chỉ có bảng style trong trình duyệt mới thấy.
 *
 * Không kiểm được lớp vẽ THẬT: Playwright không kích hoạt được autofill gốc.
 * Cái kiểm được, và là rủi ro thật, là luật có tới trình duyệt hay không.
 */
test("luật autofill tới được trình duyệt sau khi build", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Mật khẩu", { exact: true }).waitFor();

  const found = await page.evaluate(() => {
    const hits: string[] = [];
    for (const sheet of Array.from(document.styleSheets)) {
      let rules: CSSRuleList;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // stylesheet khác origin
      }
      const walk = (list: CSSRuleList) => {
        for (const rule of Array.from(list)) {
          if (rule.cssText.includes("-webkit-autofill")) hits.push(rule.cssText);
          const nested = (rule as CSSGroupingRule).cssRules;
          if (nested) walk(nested);
        }
      };
      walk(rules);
    }
    return hits;
  });

  expect(found.length, "không tìm thấy luật -webkit-autofill nào trong bảng style").toBeGreaterThan(0);
  const all = found.join("\n");
  expect(all, "phải repaint bằng box-shadow — autofill bỏ qua background-color").toContain("box-shadow");
  expect(all, "phải có bản cho .dark").toContain(".dark");
});

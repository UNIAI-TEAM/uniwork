import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { registerVerified } from "./auth-nav";
import { auditText } from "./contrast";
import { enableMfaForE2E } from "./db";

/**
 * Tương phản chữ của console /admin ở cả hai chế độ. Phép đo ở `./contrast`.
 *
 * Console có hai chỗ không surface nào khác có: băng "tạm ngưng" dùng nền
 * `bg-destructive/10` với chữ `text-destructive`, và thanh đo hạn mức đổi màu
 * theo mức dùng. Đọc giá trị token không chứng minh được gì — chỉ phép đo trên
 * trang đã render mới thấy.
 */
const dbUrl =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable";

function grantPlatformAdmin(to: string) {
  execFileSync(
    "go",
    ["run", "./cmd/uniwork-admin", "grant-platform-role", "--email", to, "--role", "admin", "--reason", "e2e contrast fixture"],
    { cwd: new URL("../server", import.meta.url), env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" },
  );
}

async function setMode(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
}

/** Đăng ký, qua onboarding, cấp quyền platform admin, dừng ở console. */
async function reachConsole(page: Page, tag: string, stamp: number) {
  const { email } = await registerVerified(page, tag, stamp);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("radio", { name: "Quản lý" }).click();
  await page.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Console ${stamp}`);
  await page.getByRole("button", { name: `Tạo Console ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill("Đội Ops");
  await page.getByRole("button", { name: "Tạo Đội Ops" }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(/\/tasks$/, { timeout: 15_000 });
  grantPlatformAdmin(email);
  await enableMfaForE2E(email);
}

for (const mode of ["light", "dark"] as const) {
  test(`tương phản chữ của console admin đạt WCAG AA — ${mode}`, async ({ page }) => {
    test.slow();
    const stamp = Date.now();
    await page.setViewportSize({ width: 1440, height: 900 });
    await reachConsole(page, `AdminContrast${mode}`, stamp);

    // Tổng quan: thẻ tín hiệu, trong đó có thẻ tone cảnh báo và tone lỗi.
    await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible({ timeout: 15_000 });
    await setMode(page, mode);
    const overview = await auditText(page);
    expect(overview.colorLevel4, "trình duyệt không nhận CSS Color 4 trong canvas — phép đo sẽ sai âm thầm").toBe(true);
    expect(overview.checked, "không đo được node chữ nào — selector đã trượt").toBeGreaterThan(10);
    expect(overview.fails, `Tổng quan (${mode}): ${overview.fails.join(" | ")}`).toEqual([]);

    // Danh sách: badge trạng thái, cột mono, thanh phân trang.
    await page.goto("/admin/organizations");
    await page.getByLabel("Tìm tổ chức").fill(`Console ${stamp}`);
    await expect(page.getByRole("link", { name: `Console ${stamp}` })).toBeVisible({ timeout: 15_000 });
    await setMode(page, mode);
    const list = await auditText(page);
    expect(list.fails, `Danh sách tổ chức (${mode}): ${list.fails.join(" | ")}`).toEqual([]);

    // Chi tiết + băng tạm ngưng: nền destructive/10 với chữ destructive.
    await page.getByRole("link", { name: `Console ${stamp}` }).click();
    await expect(page).toHaveURL(/\/admin\/organizations\/[0-9A-Z]+$/, { timeout: 15_000 });
    await page.getByRole("button", { name: "Tạm ngưng" }).click();
    await page.getByLabel("Lý do").fill("Đo tương phản băng tạm ngưng");
    await page.getByRole("button", { name: "Xác nhận" }).click();
    await expect(page.getByText(/Tạm ngưng từ/)).toBeVisible({ timeout: 15_000 });
    await setMode(page, mode);
    const detail = await auditText(page);
    expect(detail.fails, `Chi tiết tổ chức đang tạm ngưng (${mode}): ${detail.fails.join(" | ")}`).toEqual([]);

    // Trace rỗng, Flags và System: ba nền còn lại của console.
    for (const [path, label] of [
      ["/admin/flags", "Flags"],
      ["/admin/trace", "Trace"],
      ["/admin/system", "Hệ thống"],
    ] as const) {
      await page.goto(path);
      await expect(page.getByRole("heading").first()).toBeVisible({ timeout: 15_000 });
      await setMode(page, mode);
      const audit = await auditText(page);
      expect(audit.fails, `${label} (${mode}): ${audit.fails.join(" | ")}`).toEqual([]);
    }
  });
}

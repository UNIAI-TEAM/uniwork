import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { verifyEmail } from "./auth-nav";

// The golden path for F-11: a platform admin (granted by the CLI, the only
// way there is) suspends an organization from /admin, its member is shut
// out with the suspended page instead of an error, and unsuspending lets
// them back in. Requires `make dev`.
const stamp = Date.now();
const email = `admin-${stamp}@example.com`;
const orgSlug = `nen-tang-${stamp}`;
const dbUrl =
  process.env.E2E_DATABASE_URL ??
  process.env.DATABASE_URL ??
  "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable";

function grantPlatformAdmin(to: string) {
  execFileSync(
    "go",
    ["run", "./cmd/uniwork-admin", "grant-platform-role", "--email", to, "--role", "admin", "--reason", "e2e platform admin fixture"],
    { cwd: new URL("../server", import.meta.url), env: { ...process.env, DATABASE_URL: dbUrl }, stdio: "pipe" },
  );
}

test("a platform admin suspends and unsuspends an organization from /admin", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill("Platform Admin");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("radio", { name: "Quản lý" }).click();
  await page.getByRole("checkbox", { name: "Họp trực tuyến" }).click();
  await page.getByRole("button", { name: "Tiếp tục" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Nền tảng ${stamp}`);
  await page.getByRole("button", { name: `Tạo Nền tảng ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill("Đội Ops");
  await page.getByRole("button", { name: "Tạo Đội Ops" }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/doi-ops/tasks$`), { timeout: 15_000 });

  // Without a platform role the console does not exist.
  await page.goto("/admin");
  await expect(page).not.toHaveURL(/\/admin/, { timeout: 15_000 });

  grantPlatformAdmin(email);

  await page.goto("/admin");
  // The console opens on platform health, and the nav is the way to the tenants.
  await expect(page.getByRole("heading", { name: "Tổng quan" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Sẵn sàng", { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "Tổ chức", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/organizations$/, { timeout: 15_000 });
  await page.getByLabel("Tìm tổ chức").fill(orgSlug);
  await page.getByRole("link", { name: `Nền tảng ${stamp}` }).click();
  await expect(page).toHaveURL(/\/admin\/organizations\/[0-9A-Z]+$/, { timeout: 15_000 });

  await page.getByRole("button", { name: "Tạm ngưng" }).click();
  const confirm = page.getByRole("button", { name: "Xác nhận" });
  await expect(confirm).toBeDisabled();
  await page.getByLabel("Lý do").fill("Khách hàng chưa thanh toán hóa đơn");
  await confirm.click();
  await expect(page.getByText(/Tạm ngưng từ/)).toBeVisible({ timeout: 15_000 });

  // The member side: a suspended tenant shows the notice, not an error.
  await page.goto(`/${orgSlug}/doi-ops/tasks`);
  await expect(page.getByText("Tổ chức đang tạm ngưng")).toBeVisible({ timeout: 15_000 });

  await page.goBack();
  await expect(page).toHaveURL(/\/admin\/organizations\//);
  await page.getByRole("button", { name: "Bỏ tạm ngưng" }).click();
  await page.getByLabel("Lý do").fill("Đã thanh toán đủ hóa đơn");
  await page.getByRole("button", { name: "Xác nhận" }).click();
  await expect(page.getByText(/Tạm ngưng từ/)).toHaveCount(0, { timeout: 15_000 });

  await page.goto(`/${orgSlug}/doi-ops/tasks`);
  await expect(page.getByText("Tổ chức đang tạm ngưng")).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`/${orgSlug}/doi-ops/tasks$`));
});

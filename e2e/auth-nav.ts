import { expect, type Page } from "@playwright/test";

/**
 * Đăng ký + xác thực email dùng chung cho mọi spec.
 *
 * Đăng ký xong app đưa tới /verify; mã thật đi qua email, còn ở local/CI server
 * chấp nhận DEV_VERIFICATION_CODE (mặc đnh 123456 trong .env.example) — spec
 * đọc E2E_VERIFICATION_CODE để hai bên có thể khác nhau khi cần.
 */
export const VERIFICATION_CODE = process.env.E2E_VERIFICATION_CODE ?? "123456";

const NAV_TIMEOUT_MS = 15_000;

export interface RegisteredUser {
  stamp: number;
  email: string;
}

async function expectCredentialResponse(page: Page, action: Promise<void>, path: string, label: string) {
  const response = page.waitForResponse(
    (r) => r.url().includes(path) && r.request().method() === "POST",
    { timeout: NAV_TIMEOUT_MS },
  );
  await action;
  const res = await response;
  if (!res.ok()) {
    throw new Error(`${label} failed: HTTP ${res.status()} ${await res.text()}`);
  }
}

/** Điền form đăng ký và dừng ở /verify (chưa nhập mã). */
export async function register(page: Page, tag: string, stamp = Date.now()): Promise<RegisteredUser> {
  const email = `${tag.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(tag);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await expectCredentialResponse(
    page,
    page.getByRole("button", { name: "Đăng ký" }).click(),
    "/api/v1/auth/register",
    "register",
  );
  await expect(page).toHaveURL(/\/verify$/, { timeout: NAV_TIMEOUT_MS });
  return { stamp, email };
}

/** Nhập mã trên /verify; kết thúc ở /onboarding cho user mới. */
export async function verifyEmail(page: Page, code = VERIFICATION_CODE): Promise<void> {
  await expectCredentialResponse(
    page,
    page.getByLabel("Mã xác thực").fill(code),
    "/api/v1/me/email/verify",
    "verify",
  );
  await expect(page).toHaveURL(/\/onboarding$/, { timeout: NAV_TIMEOUT_MS });
}

/** Đăng ký rồi xác thực: điểm xuất phát của mọi spec onboarding. */
export async function registerVerified(page: Page, tag: string, stamp = Date.now()): Promise<RegisteredUser> {
  const user = await register(page, tag, stamp);
  await verifyEmail(page);
  return user;
}

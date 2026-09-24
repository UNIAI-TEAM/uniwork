import { expect, type Page, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyEmail } from "./auth-nav";
import { captureAuth } from "./tasks-seed";

/**
 * Step 0 regression spec for avatars (UNI-744, plan T6).
 *
 * Pins what the legacy path does today: setting an avatar, replacing it, the
 * account-level avatar showing up in a second organization's shell, and a
 * non-image file being refused before it reaches storage.
 *
 * The @files-smoke test is the shortest proof the module is alive; run it
 * alone with:
 *   pnpm --filter @uniwork/e2e exec playwright test --grep @files-smoke e2e/files-avatar.spec.ts
 */
// The first navigation after each Next.js route compiles in dev, so the
// file budget is generous while the individual assertions stay tight.
test.describe.configure({ timeout: 180_000 });

const stamp = Date.now();

// Two real 1x1 PNGs with different pixels, so "the second upload replaced the
// first" is visible in the served URL and not just in a re-encoded equal file.
const AVATAR_ONE = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSjsDAAICAVXMT1lvAAAAAElFTkSuQmCC",
  "base64",
);
const AVATAR_TWO = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGM4YywIAALfARHxk3LHAAAAAElFTkSuQmCC",
  "base64",
);

interface Workspace {
  name: string;
  email: string;
  orgName: string;
  wsName: string;
  orgSlug: string;
  wsSlug: string;
}

/** Names stay ASCII so the slugs the onboarding form derives are predictable. */
function workspaceFor(label: string): Workspace {
  return {
    name: `Avatar ${label}`,
    email: `avatar-${label}-${stamp}@example.com`,
    orgName: `Avatar ${label} ${stamp}`,
    wsName: `Team ${label} ${stamp}`,
    orgSlug: `avatar-${label}-${stamp}`,
    wsSlug: `team-${label}-${stamp}`,
  };
}

async function onboard(page: Page, w: Workspace): Promise<void> {
  await page.goto("/register");
  await page.getByLabel("Tên hiển thị").fill(w.name);
  await page.getByLabel("Email").fill(w.email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng ký" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(w.orgName);
  await page.getByRole("button", { name: `Tạo ${w.orgName}` }).click();
  await page.getByLabel("Tên workspace").fill(w.wsName);
  await page.getByRole("button", { name: `Tạo ${w.wsName}` }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(new RegExp(`/${w.orgSlug}/${w.wsSlug}/tasks`), { timeout: 60_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 30_000 });
}

function tmpPng(name: string, bytes: Buffer): string {
  const file = path.join(os.tmpdir(), `uni744-avatar-${stamp}-${name}`);
  fs.writeFileSync(file, bytes);
  return file;
}

/** The profile tab holds the only image-only file input in the shell. */
function avatarInput(page: Page) {
  return page.locator('input[type="file"][accept*="image/png"]');
}

async function openProfileTab(page: Page, w: Workspace): Promise<void> {
  await page.goto(`/${w.orgSlug}/${w.wsSlug}/settings?tab=profile`);
  await expect(avatarInput(page)).toBeAttached({ timeout: 20_000 });
}

/** The account trigger in the sidebar footer carries the account's email. */
function sidebarAvatar(page: Page, email: string) {
  return page.locator(`button[aria-label*="${email}"] img`).first();
}

test("@files-smoke avatar: đổi ảnh, thấy ở header", async ({ page }) => {
  const w = workspaceFor("smoke");
  await onboard(page, w);
  await openProfileTab(page, w);

  await avatarInput(page).setInputFiles(tmpPng("one.png", AVATAR_ONE));
  await expect(page.getByText("Đã cập nhật ảnh đại diện")).toBeVisible({ timeout: 20_000 });

  const avatar = sidebarAvatar(page, w.email);
  await expect(avatar).toBeVisible({ timeout: 20_000 });
  await expect(avatar).toHaveAttribute("src", /\/uploads\/avatars\/.+\.png$/);
});

test("thay avatar lần hai, hiện ở tổ chức thứ hai", async ({ page }) => {
  const w = workspaceFor("replace");
  await onboard(page, w);
  const auth = await captureAuth(page);

  await openProfileTab(page, w);
  await avatarInput(page).setInputFiles(tmpPng("one.png", AVATAR_ONE));
  const first = sidebarAvatar(page, w.email);
  await expect(first).toHaveAttribute("src", /\/uploads\/avatars\/.+\.png$/, { timeout: 20_000 });
  const firstSrc = await first.getAttribute("src");

  await avatarInput(page).setInputFiles(tmpPng("two.png", AVATAR_TWO));
  await expect
    .poll(() => sidebarAvatar(page, w.email).getAttribute("src"), { timeout: 20_000 })
    .not.toBe(firstSrc);
  const secondSrc = await sidebarAvatar(page, w.email).getAttribute("src");
  expect(secondSrc).toMatch(/\/uploads\/avatars\/.+\.png$/);

  // A second organization for the same account: the avatar belongs to the
  // account, so the shell in the second org shows the same image.
  const orgSlug = `avatar-second-${stamp}`;
  const wsSlug = `avatar-second-team-${stamp}`;
  const orgRes = await page.request.post(`${auth.api}/api/v1/orgs`, {
    headers: { authorization: auth.auth },
    data: { name: `Avatar Second ${stamp}`, slug: orgSlug },
  });
  expect(orgRes.status()).toBe(201);
  const orgId = ((await orgRes.json()) as { organization: { id: string } }).organization.id;

  const wsRes = await page.request.post(`${auth.api}/api/v1/orgs/${orgId}/workspaces`, {
    headers: { authorization: auth.auth },
    data: { name: `Avatar Second Team ${stamp}`, slug: wsSlug },
  });
  expect(wsRes.status()).toBe(201);

  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  const inSecondOrg = sidebarAvatar(page, w.email);
  await expect(inSecondOrg).toHaveAttribute("src", secondSrc ?? "", { timeout: 20_000 });
});

test("ảnh sai loại bị từ chối", async ({ page }) => {
  const w = workspaceFor("wrongtype");
  await onboard(page, w);
  await openProfileTab(page, w);

  const file = path.join(os.tmpdir(), `uni744-avatar-${stamp}-not-image.txt`);
  fs.writeFileSync(file, "not an image\n");
  await avatarInput(page).setInputFiles(file);

  await expect(page.getByText("Ảnh phải là PNG, JPEG, GIF hoặc WebP.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(sidebarAvatar(page, w.email)).toHaveCount(0);
});
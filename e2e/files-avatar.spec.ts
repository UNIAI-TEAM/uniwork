import { expect, type Page, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onboardToWorkspace, workspaceSeed, type WorkspaceSeed } from "./onboard";
import { createRecordingAccount } from "./meeting-recording-fixture";
import { captureAuth } from "./tasks-seed";

/**
 * Step 0 regression spec for avatars (UNI-744, plan T6).
 *
 * Pinned on the legacy path first (Bước 0), now run on FileService: setting
 * an avatar, replacing it, the account-level avatar showing up in a second
 * organization's shell, a non-image file being refused before it reaches
 * storage, and another organization failing to resolve the avatar's file.
 *
 * Intended change at cutover (UNI-747): the avatar is a presign purpose, so
 * the src is a signed storage URL (12h) under the user's avatars/ prefix
 * instead of /uploads/avatars/<name>.png. A fresh signature is minted on each
 * read, so "the same image" is compared on the object path, not the full URL.
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

function workspaceFor(label: string): WorkspaceSeed {
  return workspaceSeed("avatar", label, stamp);
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

async function openProfileTab(page: Page, w: WorkspaceSeed): Promise<void> {
  await page.goto(`/${w.orgSlug}/${w.wsSlug}/settings?tab=profile`);
  await expect(avatarInput(page)).toBeAttached({ timeout: 20_000 });
}

/** The account trigger in the sidebar footer carries the account's email. */
function sidebarAvatar(page: Page, email: string) {
  return page.locator(`button[aria-label*="${email}"] img`).first();
}

/** A signed avatar URL: the users/<id>/avatars/ object plus its signature. */
const AVATAR_SRC = /\/users\/[0-9A-Z]+\/avatars\/.+X-Amz-Signature=/;

/** The object the src names, without the per-read signature. */
function objectPath(src: string | null): string {
  return src ? new URL(src).pathname : "";
}

/** The avatar's file id is the object key segment after the year/month. */
function avatarFileID(src: string | null): string {
  const id = /\/avatars\/\d{4}\/\d{2}\/([0-9A-Z]+)\//.exec(objectPath(src))?.[1];
  if (!id) throw new Error(`no file id in avatar src ${src}`);
  return id;
}

/** The browser really decoded the bytes behind the src. */
async function expectDecoded(page: Page, email: string): Promise<void> {
  await expect
    .poll(() => sidebarAvatar(page, email).evaluate((img) => (img as HTMLImageElement).naturalWidth), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
}

test("@files-smoke avatar: đổi ảnh, thấy ở header", async ({ page }) => {
  const w = workspaceFor("smoke");
  await onboardToWorkspace(page, w);
  await openProfileTab(page, w);

  await avatarInput(page).setInputFiles(tmpPng("one.png", AVATAR_ONE));
  await expect(page.getByText("Đã cập nhật ảnh đại diện")).toBeVisible({ timeout: 20_000 });

  const avatar = sidebarAvatar(page, w.email);
  await expect(avatar).toBeVisible({ timeout: 20_000 });
  await expect(avatar).toHaveAttribute("src", AVATAR_SRC);
  await expectDecoded(page, w.email);
});

test("thay avatar lần hai, hiện ở tổ chức thứ hai", async ({ page }) => {
  const w = workspaceFor("replace");
  await onboardToWorkspace(page, w);
  const auth = await captureAuth(page);

  await openProfileTab(page, w);
  await avatarInput(page).setInputFiles(tmpPng("one.png", AVATAR_ONE));
  const first = sidebarAvatar(page, w.email);
  await expect(first).toHaveAttribute("src", AVATAR_SRC, { timeout: 20_000 });
  const firstPath = objectPath(await first.getAttribute("src"));

  await avatarInput(page).setInputFiles(tmpPng("two.png", AVATAR_TWO));
  await expect
    .poll(async () => objectPath(await sidebarAvatar(page, w.email).getAttribute("src")), { timeout: 20_000 })
    .not.toBe(firstPath);
  const secondSrc = await sidebarAvatar(page, w.email).getAttribute("src");
  expect(secondSrc).toMatch(AVATAR_SRC);
  await expectDecoded(page, w.email);

  // A second organization for the same account: the avatar belongs to the
  // account, so the shell in the second org shows the same image. An account
  // belongs to one active organization at a time (ADR 0032), so another
  // person founds the second organization and invites this account, which
  // switches to it by closing the organization it founded alone.
  const host = await createRecordingAccount(page, auth.api, "avatar-host");
  const invited = await page.request.post(`${auth.api}/api/v1/workspaces/${host.wsId}/invitations`, {
    headers: { authorization: `Bearer ${host.token}` },
    data: { emails: [w.email], role: "member" },
  });
  expect(invited.ok(), `invite: HTTP ${invited.status()} ${await invited.text()}`).toBeTruthy();
  const listed = await page.request.get(`${auth.api}/api/v1/me/invitations`, { headers: { authorization: auth.auth } });
  expect(listed.ok()).toBeTruthy();
  const token = ((await listed.json()) as { invitations: { token: string }[] }).invitations[0]?.token;
  expect(token, `no invitation for ${w.email}`).toBeTruthy();
  const preview = await page.request.get(`${auth.api}/api/v1/invitations/${token}`, { headers: { authorization: auth.auth } });
  expect(preview.ok()).toBeTruthy();
  const { conflicts } = (await preview.json()) as {
    conflicts: { organization: { id: string; slug: string }; required_action: string }[];
  };
  expect(conflicts.map((c) => [c.organization.slug, c.required_action])).toEqual([[w.orgSlug, "close"]]);
  const accepted = await page.request.post(`${auth.api}/api/v1/invitations/${token}/accept`, {
    headers: { authorization: auth.auth },
    data: { resolve: [{ organization_id: conflicts[0].organization.id, action: "close", confirm_slug: w.orgSlug }] },
  });
  expect(accepted.ok(), `accept: HTTP ${accepted.status()} ${await accepted.text()}`).toBeTruthy();

  // What the shell's workspace gate asks for: the account must now resolve the
  // second organization's workspace by its slugs, whatever the page then does.
  const resolvedWs = await page.request.get(`${auth.api}/api/v1/orgs/${host.orgSlug}/workspaces/${host.wsSlug}`, {
    headers: { authorization: auth.auth },
  });
  expect(resolvedWs.ok(), `the switched account reads the new workspace: HTTP ${resolvedWs.status()} ${await resolvedWs.text()}`).toBeTruthy();

  await page.goto(`/${host.orgSlug}/${host.wsSlug}/tasks`);
  // The URL is read when the shell should be up, not when goto returns: a guard
  // redirect (login, workspace picker) lands after it. On a miss the error
  // carries the URL and the page text, so a redirect and an empty shell differ.
  const trigger = page.locator(`button[aria-label*="${w.email}"]`);
  try {
    await expect(trigger).toBeVisible({ timeout: 20_000 });
  } catch (error) {
    const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`no account trigger for ${w.email} at ${page.url()}; page text: ${text}\n${String(error)}`);
  }
  await expect
    .poll(async () => objectPath(await sidebarAvatar(page, w.email).getAttribute("src")), { timeout: 20_000 })
    .toBe(objectPath(secondSrc));
  await expectDecoded(page, w.email);

  // Someone in an unrelated organization who learns the file id cannot
  // resolve it through the files API: it is not a file they staged.
  const outsider = await createRecordingAccount(page, auth.api, "avatar-outsider");
  const resolved = await page.request.post(`${auth.api}/api/v1/workspaces/${outsider.wsId}/files/resolve`, {
    headers: { authorization: `Bearer ${outsider.token}` },
    data: { file_ids: [avatarFileID(secondSrc)] },
  });
  expect(resolved.status()).toBe(200);
  const items = ((await resolved.json()) as { items: { url?: string; error: { code: string } | null }[] }).items;
  expect(items).toHaveLength(1);
  expect(items[0].url ?? "").toBe("");
  expect(items[0].error?.code).toBe("file_not_found");
});

test("ảnh sai loại bị từ chối", async ({ page }) => {
  const w = workspaceFor("wrongtype");
  await onboardToWorkspace(page, w);
  await openProfileTab(page, w);

  const file = path.join(os.tmpdir(), `uni744-avatar-${stamp}-not-image.txt`);
  fs.writeFileSync(file, "not an image\n");
  await avatarInput(page).setInputFiles(file);

  await expect(page.getByText("Ảnh phải là PNG, JPEG, GIF hoặc WebP.")).toBeVisible({
    timeout: 20_000,
  });
  await expect(sidebarAvatar(page, w.email)).toHaveCount(0);
});
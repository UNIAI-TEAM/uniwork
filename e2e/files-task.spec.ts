import { expect, type Page, test } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { onboardToWorkspace, workspaceSeed, type WorkspaceSeed } from "./onboard";
import { captureAuth, type SeedAuth } from "./tasks-seed";

/**
 * Step 0 regression spec for task and comment attachments (UNI-744, plan T6).
 *
 * Pins what the legacy path does today on this lane's own worktree app:
 * upload -> display -> download, a comment carrying a file, an image in the
 * description across a reload, removing one of many, the 25 MiB cap, and the
 * two-organization case where a member of another org guesses the id / URL.
 *
 * The @files-smoke test is the shortest proof the module is alive; run it
 * alone with:
 *   pnpm --filter @uniwork/e2e exec playwright test --grep @files-smoke e2e/files-task.spec.ts
 */
// The first navigation after each Next.js route compiles in dev, so the
// file budget is generous while the individual assertions stay tight.
test.describe.configure({ timeout: 120_000 });

const stamp = Date.now();

// A real 1x1 PNG: the description-image case must upload something a browser
// can decode, not a payload that only sniffs as an image.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNQSjsDAAICAVXMT1lvAAAAAElFTkSuQmCC",
  "base64",
);

function workspaceFor(label: string): WorkspaceSeed {
  return workspaceSeed("files", label, stamp);
}

/**
 * Task creation is fixture setup here: the module under test is the file
 * surface, so the task is created through the page's own authenticated API
 * (the pattern tasks-seed.ts uses) and the detail route is opened directly.
 */
async function createTask(page: Page, auth: SeedAuth, title: string): Promise<string> {
  const res = await page.request.post(`${auth.api}/api/v1/workspaces/${auth.wsId}/tasks`, {
    headers: { authorization: auth.auth, "content-type": "application/json" },
    data: { title },
  });
  expect(res.status(), await res.text()).toBe(200);
  const body = (await res.json()) as { task: { id: string } };
  expect(body.task.id).toBeTruthy();
  return body.task.id;
}

async function openTask(page: Page, w: WorkspaceSeed, taskId: string): Promise<void> {
  await page.goto(`/${w.orgSlug}/${w.wsSlug}/tasks/${taskId}`);
  await expect(page.getByTestId("task-detail-suite")).toBeVisible({ timeout: 30_000 });
}
function tmpFile(name: string, body: string | Buffer): string {
  const file = path.join(os.tmpdir(), `uni744-${stamp}-${name}`);
  fs.writeFileSync(file, body);
  return file;
}

/**
 * The description editor's paperclip input. FileUploadButton renders no
 * label/testid, but every other file input on the detail page lives under
 * [data-testid="task-comment-composer"], so excluding that ancestor pins the
 * description input structurally instead of by DOM order.
 */
function descriptionUpload(page: Page) {
  return page
    .locator('xpath=//input[@type="file" and not(ancestor::*[@data-testid="task-comment-composer"])]')
    .first();
}

interface UploadedAttachment {
  id: string;
  filename: string;
  url: string;
  download_url: string;
}

async function uploadIntoDescription(page: Page, file: string): Promise<UploadedAttachment> {
  const posted = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/v1\/tasks\/[0-9A-Z]+\/attachments$/.test(new URL(res.url()).pathname),
    { timeout: 30_000 },
  );
  await descriptionUpload(page).setInputFiles(file);
  const res = await posted;
  expect(res.status()).toBe(200);
  return (await res.json()) as UploadedAttachment;
}

test("@files-smoke đính kèm task: tải lên, thấy tệp, tải về đúng bytes", async ({ page }) => {
  const w = workspaceFor("smoke");
  await onboardToWorkspace(page, w);
  const auth = await captureAuth(page);
  await openTask(page, w, await createTask(page, auth, `Việc smoke ${stamp}`));

  const body = `uniwork files smoke ${stamp}\n`;
  const file = tmpFile("smoke.txt", body);
  const att = await uploadIntoDescription(page, file);
  expect(att.filename).toBe(path.basename(file));
  await expect(page.getByText(path.basename(file)).first()).toBeVisible({ timeout: 20_000 });

  // Download through the page's own authenticated fetch: the same request the
  // UI makes, with the bearer token the shell holds.
  const download = await page.evaluate(
    async ({ url, token }) => {
      const res = await fetch(url, { headers: { authorization: token } });
      return { status: res.status, text: await res.text() };
    },
    { url: `${auth.api}${att.download_url}`, token: auth.auth },
  );
  expect(download.status).toBe(200);
  expect(download.text).toBe(body);
});

test("bình luận kèm tệp: gửi bình luận có đính kèm", async ({ page }) => {
  const w = workspaceFor("comment");
  await onboardToWorkspace(page, w);
  await openTask(page, w, await createTask(page, await captureAuth(page), `Việc bình luận ${stamp}`));

  const file = tmpFile("comment.txt", `comment attachment ${stamp}\n`);
  await page.getByTestId("task-comment-composer-shell").click();
  const composerInput = page.locator('[data-testid="task-comment-composer"] input[type="file"]');
  await expect(composerInput).toBeAttached({ timeout: 20_000 });
  await composerInput.setInputFiles(file);

  const editor = page.locator('[data-testid="task-comment-composer"] .ProseMirror');
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.click();
  await page.keyboard.type(`Bình luận kèm tệp ${stamp}`);
  await page.locator('[data-testid="task-comment-composer"] button[aria-label="Gửi"]').click();

  await expect(page.getByText(`Bình luận kèm tệp ${stamp}`)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(path.basename(file)).first()).toBeVisible({ timeout: 20_000 });
});

test("ảnh trong mô tả sống sót sau khi tải lại", async ({ page }) => {
  const w = workspaceFor("image");
  await onboardToWorkspace(page, w);
  await openTask(page, w, await createTask(page, await captureAuth(page), `Việc ảnh ${stamp}`));

  const file = tmpFile("shot.png", TINY_PNG);
  await uploadIntoDescription(page, file);

  const image = page.locator('img[src^="blob:"], img[src*="/api/v1/attachments/"]').first();
  await expect(image).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => image.evaluate((el) => (el as HTMLImageElement).naturalWidth), { timeout: 20_000 })
    .toBeGreaterThan(0);

  await page.reload();
  const afterReload = page.locator('img[src^="blob:"], img[src*="/api/v1/attachments/"]').first();
  await expect(afterReload).toBeVisible({ timeout: 20_000 });
  await expect
    .poll(() => afterReload.evaluate((el) => (el as HTMLImageElement).naturalWidth), {
      timeout: 20_000,
    })
    .toBeGreaterThan(0);
});

test("gỡ một trong nhiều tệp đính kèm", async ({ page }) => {
  const w = workspaceFor("remove");
  await onboardToWorkspace(page, w);
  await openTask(page, w, await createTask(page, await captureAuth(page), `Việc gỡ tệp ${stamp}`));

  const first = path.basename(tmpFile("first.txt", `first ${stamp}\n`));
  const second = path.basename(tmpFile("second.txt", `second ${stamp}\n`));
  await uploadIntoDescription(page, path.join(os.tmpdir(), `uni744-${stamp}-first.txt`));
  await uploadIntoDescription(page, path.join(os.tmpdir(), `uni744-${stamp}-second.txt`));

  // Undo the two file cards in the draft: both rows become standalone
  // attachments, which is what the section below the description lists.
  const editor = page.locator(".ProseMirror").first();
  await editor.click();
  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  // The autosave is debounced 1500ms, and it only goes out when the draft
  // differs from the saved description — after the undos it can be identical
  // again, so a bare waitForResponse could wait on a PUT that never happens.
  // Typing a marker makes a save mandatory and gives the PUT a unique body:
  // an earlier in-flight save (the card inserts also schedule one) cannot
  // carry it. This replaces the old fixed 2.5s sleep that could lose to the
  // debounce under load.
  const marker = `marker-${stamp}`;
  const undoSaved = page.waitForResponse(
    (res) =>
      res.request().method() === "PUT" &&
      /\/api\/v1\/tasks\/[0-9A-Z]+$/.test(new URL(res.url()).pathname) &&
      (res.request().postData() ?? "").includes(marker),
    { timeout: 30_000 },
  );
  await page.keyboard.type(marker);
  expect((await undoSaved).status()).toBe(200);
  await page.reload();

  const section = page.getByRole("region", { name: "Đính kèm" });
  await expect(section.getByText(first)).toBeVisible({ timeout: 20_000 });
  await expect(section.getByText(second)).toBeVisible({ timeout: 20_000 });

  await section
    .locator("div", { hasText: first })
    .getByRole("button", { name: "Gỡ tệp đính kèm" })
    .first()
    .click();
  await page.getByRole("button", { name: "Xóa", exact: true }).click();

  await expect(section.getByText(first)).toHaveCount(0, { timeout: 20_000 });
  await expect(section.getByText(second)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("region", { name: "Đính kèm" }).getByText(second)).toBeVisible({
    timeout: 20_000,
  });
});

test("tệp trên 25 MiB bị từ chối", async ({ page }) => {
  const w = workspaceFor("cap");
  await onboardToWorkspace(page, w);
  await openTask(page, w, await createTask(page, await captureAuth(page), `Việc quá cỡ ${stamp}`));

  const file = tmpFile("big.txt", Buffer.alloc(26 * 1024 * 1024, "x"));
  await descriptionUpload(page).setInputFiles(file);

  await expect(page.getByText(/Không tải lên được/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Đính kèm" })).toHaveCount(0);
});

test("loại tệp không được hỗ trợ bị từ chối", async ({ page }) => {
  const w = workspaceFor("mime");
  await onboardToWorkspace(page, w);
  await openTask(page, w, await createTask(page, await captureAuth(page), `Việc sai loại ${stamp}`));

  // FileUploadButton has no accept filter, so a type outside the server's
  // allowedAttachmentMIME (application/zip here) really reaches the API and
  // is answered 400 attachment_mime_rejected. The declared Content-Type is
  // what the allowlist reads, so the body can be anything.
  const rejected = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      /\/api\/v1\/tasks\/[0-9A-Z]+\/attachments$/.test(new URL(res.url()).pathname),
    { timeout: 30_000 },
  );
  await descriptionUpload(page).setInputFiles({
    name: `payload-${stamp}.zip`,
    mimeType: "application/zip",
    buffer: Buffer.from(`not a real zip ${stamp}`),
  });
  expect((await rejected).status()).toBe(400);

  await expect(page.getByText(/Không tải lên được/)).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("region", { name: "Đính kèm" })).toHaveCount(0);
});

test("tổ chức khác đoán URL tệp thì bị chặn", async ({ browser }) => {
  const ownerContext = await browser.newContext({ locale: "vi-VN" });
  const ownerPage = await ownerContext.newPage();
  const owner = workspaceFor("owner");
  await onboardToWorkspace(ownerPage, owner);
  const ownerAuth = await captureAuth(ownerPage);
  await openTask(ownerPage, owner, await createTask(ownerPage, ownerAuth, `Việc riêng tư ${stamp}`));
  const att = await uploadIntoDescription(
    ownerPage,
    tmpFile("private.txt", `private ${stamp}\n`),
  );

  const otherContext = await browser.newContext({ locale: "vi-VN" });
  const otherPage = await otherContext.newPage();
  const other = workspaceFor("other");
  await onboardToWorkspace(otherPage, other);
  const otherAuth = await captureAuth(otherPage);

  for (const endpoint of [att.download_url, `/api/v1/attachments/${att.id}/content`]) {
    const blocked = await otherPage.request.get(`${ownerAuth.api}${endpoint}`, {
      headers: { authorization: otherAuth.auth },
    });
    expect(blocked.status(), `${endpoint} for another organization`).toBe(403);
  }

  const allowed = await ownerPage.request.get(`${ownerAuth.api}${att.download_url}`, {
    headers: { authorization: ownerAuth.auth },
  });
  expect(allowed.status()).toBe(200);

  await ownerContext.close();
  await otherContext.close();
});
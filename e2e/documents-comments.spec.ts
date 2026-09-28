import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { verifyEmail } from "./auth-nav";
import { workspaceSeed, type WorkspaceSeed } from "./onboard";

/**
 * Lane g1-07c (UNI-681) AC-3 evidence: the document comments panel on the real
 * stack — post a comment, reply, react, resolve, reload, and the light/dark,
 * vi/en and mobile screenshots the brief asks for.
 *
 * Needs: documents flag ON (`FF_DOCUMENTS=true`), Postgres + Redis up, this
 * worktree's migrations applied, web app on E2E_BASE_URL. Recipe:
 * reports/g1-07c-comments-panel/serve.sh + run-e2e.sh in the run folder.
 */
test.describe.configure({ timeout: 360_000 });

const stamp = Date.now();
const seed = workspaceSeed("comments", "panel", stamp);
const SHOTS =
  process.env.DOCUMENT_SHOT_DIR ?? resolve(process.cwd(), "test-results", "documents-comments-shots");

const DOCUMENT_URL = /\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/;

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}

function pane(page: Page): Locator {
  return page.getByTestId("document-comments-pane");
}

/** The composer is lazy: the stand-in must be clicked before the editor exists. */
async function typeInComposer(page: Page, scope: Locator, text: string) {
  await scope.getByRole("button", { name: /Viết bình luận|Write a comment/ }).click();
  const editor = scope.getByRole("textbox", { name: /Viết bình luận|Write a comment/ });
  await editor.click();
  await editor.pressSequentially(text);
  await scope.getByRole("button", { name: /^Gửi$|^Send$/ }).click();
}

async function openPanel(page: Page) {
  await page.getByRole("button", { name: /Bình luận|^Comments$/ }).click();
  await expect(pane(page)).toBeVisible({ timeout: 30_000 });
}

/**
 * Register -> verify -> org -> workspace -> skip invites. Mirrors
 * `onboardToWorkspace` with the invite-step retry `documents.spec.ts` added for
 * `next dev`: the skip click can land while the next route is still compiling.
 */
async function onboard(page: Page, w: WorkspaceSeed) {
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

  const workspaceUrl = new RegExp(`/${w.orgSlug}/${w.wsSlug}/tasks`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
    try {
      await page.waitForURL(workspaceUrl, { timeout: 30_000 });
      break;
    } catch {
      // Still on the invite step: the click raced the route compile.
    }
  }
  await expect(page).toHaveURL(workspaceUrl, { timeout: 120_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 30_000 });
}

test("comments panel posts, replies, reacts, resolves and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page, seed);

  await page.goto(`/${seed.orgSlug}/${seed.wsSlug}/documents`);
  await page.getByRole("button", { name: "Trang mới" }).first().click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });

  const surface = page.getByRole("textbox", { name: "Nội dung tài liệu" });
  await expect(surface).toBeVisible({ timeout: 60_000 });
  await surface.click();
  await page.keyboard.type("Tài liệu có bình luận");
  await expect(page.getByText(/^Đã lưu/)).toBeVisible({ timeout: 30_000 });

  await openPanel(page);
  const rail = pane(page);
  await expect(rail.getByText("Chưa có bình luận.")).toBeVisible({ timeout: 30_000 });

  // Root comment.
  await typeInComposer(page, rail.getByTestId("document-comment-composer"), "Bình luận đầu tiên");
  await expect(rail.getByText("Bình luận đầu tiên").first()).toBeVisible({ timeout: 30_000 });

  // Reply inside the thread (the reply composer is its own box).
  const reply = rail.locator('[data-testid^="document-comment-reply-composer"]');
  await typeInComposer(page, reply, "Trả lời nhé");
  await expect(rail.getByText("Trả lời nhé").first()).toBeVisible({ timeout: 30_000 });

  // Reaction on the root comment.
  await rail.getByLabel("Add reaction").first().click();
  await page.getByRole("button", { name: "👍", exact: true }).click();
  await expect(rail.getByText("👍").first()).toBeVisible({ timeout: 30_000 });

  await shot(page, "document-comments-light-vi");

  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await shot(page, "document-comments-dark-vi");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // Resolve the thread: it folds behind the resolved bar.
  await rail.getByRole("button", { name: "Thao tác bình luận" }).first().click();
  await page.getByRole("menuitem", { name: "Đánh dấu đã xử lý" }).click();
  await expect(rail.getByText(/Đã giải quyết/).first()).toBeVisible({ timeout: 30_000 });

  // Reload: the server is the source of truth for the thread.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({
    timeout: 60_000,
  });
  await openPanel(page);
  await expect(rail.getByText(/Đã giải quyết/).first()).toBeVisible({ timeout: 30_000 });
  await rail.getByRole("button", { name: /Đã giải quyết/ }).first().click();
  await expect(rail.getByText("Bình luận đầu tiên").first()).toBeVisible({ timeout: 30_000 });
  await expect(rail.getByText("Trả lời nhé").first()).toBeVisible({ timeout: 30_000 });

  // English, same screen, through the language menu the app ships.
  await page.getByRole("button", { name: "Ngôn ngữ" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({
    timeout: 60_000,
  });
  await openPanel(page);
  await expect(rail.getByText("Comments", { exact: true }).first()).toBeVisible({
    timeout: 30_000,
  });
  await shot(page, "document-comments-light-en");

  // Back to Vietnamese for the mobile sheet, which is modal below xl.
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitemradio", { name: "Tiếng Việt" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({
    timeout: 60_000,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await openPanel(page);
  await shot(page, "document-comments-mobile-vi");
});

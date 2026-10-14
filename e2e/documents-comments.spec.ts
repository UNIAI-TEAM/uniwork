import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { verifyEmail } from "./auth-nav";
import { workspaceSeed, type WorkspaceSeed } from "./onboard";
import { newPageCard } from "./documents-onboard";

/**
 * The document page's own comments panel on the real stack (G8-10, EXPERIENCE-G8
 * S13): a page has the Discussion alone (no tabs; the Comments tab with anchors
 * belongs to docx/xlsx/pptx/pdf and is pinned by the unit suite). Post, reply,
 * edit with history, resolve into the folded group, reload, reopen, and the
 * light/dark, vi/en and mobile screenshots.
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

/** Types into a labelled composer box and sends it with its own Send button. */
async function typeInComposer(scope: Locator, label: RegExp, text: string) {
  const box = scope.getByRole("textbox", { name: label });
  await box.click();
  await box.pressSequentially(text);
  await scope.getByRole("button", { name: /^Gửi$|^Send$/ }).click();
}

const DISCUSSION_BOX = /Viết vào thảo luận|Write in the discussion/;
const REPLY_BOX = /Viết trả lời|Write a reply/;

async function openPanel(page: Page) {
  await page.getByRole("button", { name: /^(Thảo luận|Discussion)$/ }).click();
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

test("discussion panel posts, replies, edits, resolves, reopens and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page, seed);

  await page.goto(`/${seed.orgSlug}/${seed.wsSlug}/documents`);
  await newPageCard(page).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });

  const surface = page.getByRole("textbox", { name: "Nội dung tài liệu" });
  await expect(surface).toBeVisible({ timeout: 60_000 });
  await surface.click();
  await page.keyboard.type("Tài liệu có thảo luận");
  await expect(page.getByRole("status", { name: /^Đã lưu/ })).toBeVisible({ timeout: 30_000 });

  await openPanel(page);
  const rail = pane(page);
  await expect(rail.getByText("Chưa có thảo luận.", { exact: false })).toBeVisible({ timeout: 30_000 });
  // A page has the Discussion alone: no tablist.
  await expect(rail.getByRole("tablist")).toHaveCount(0);

  // A new Discussion post from the box at the bottom.
  await typeInComposer(rail.getByTestId("document-discussion-composer"), DISCUSSION_BOX, "Bài thảo luận đầu tiên");
  await expect(rail.getByText("Bài thảo luận đầu tiên").first()).toBeVisible({ timeout: 30_000 });

  // Reply inside the thread.
  await rail.getByRole("button", { name: "Trả lời", exact: true }).first().click();
  await typeInComposer(rail.locator('[data-testid^="document-reply-composer-"]'), REPLY_BOX, "Trả lời nhé");
  await expect(rail.getByText("Trả lời nhé").first()).toBeVisible({ timeout: 30_000 });

  // Edit the post, then read its history.
  await rail.getByRole("button", { name: /^Thao tác khác/ }).first().click();
  await page.getByRole("menuitem", { name: "Sửa", exact: true }).click();
  const editBox = rail.getByRole("textbox", { name: "Sửa" });
  await editBox.fill("Bài thảo luận đã sửa");
  await rail.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(rail.getByText("Bài thảo luận đã sửa").first()).toBeVisible({ timeout: 30_000 });
  await rail.getByRole("button", { name: /^Đã sửa/ }).first().click();
  await expect(rail.getByText("Bản hiện tại")).toBeVisible({ timeout: 30_000 });
  await expect(rail.getByText("Bài thảo luận đầu tiên").first()).toBeVisible({ timeout: 30_000 });

  await shot(page, "document-discussion-light-vi");
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await shot(page, "document-discussion-dark-vi");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // Resolve: the thread folds into the "Đã giải quyết · 1" group.
  await rail.getByRole("button", { name: "Đánh dấu đã giải quyết" }).first().click();
  const folded = rail.getByRole("button", { name: /^Đã giải quyết · 1$/ });
  await expect(folded).toBeVisible({ timeout: 30_000 });

  // Reload: the server is the source of truth for the thread.
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await openPanel(page);
  await rail.getByRole("button", { name: /^Đã giải quyết · 1$/ }).click();
  await expect(rail.getByText("Bài thảo luận đã sửa").first()).toBeVisible({ timeout: 30_000 });
  await expect(rail.getByText("Trả lời nhé").first()).toBeVisible({ timeout: 30_000 });

  // Reopen brings it back to the open list.
  await rail.getByRole("button", { name: "Mở lại" }).first().click();
  await expect(rail.getByRole("button", { name: /^Đã giải quyết · / })).toHaveCount(0, { timeout: 30_000 });

  // English, same screen, through the language menu the app ships.
  await page.getByRole("button", { name: "Ngôn ngữ" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({ timeout: 60_000 });
  await openPanel(page);
  await expect(rail.getByRole("heading", { name: "Discussion", exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(rail.getByRole("button", { name: "Resolve", exact: true }).first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "document-discussion-light-en");

  // Back to Vietnamese for the mobile sheet, which is modal below xl.
  await page.getByRole("button", { name: "Language" }).click();
  await page.getByRole("menuitemradio", { name: "Tiếng Việt" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({ timeout: 60_000 });
  await page.setViewportSize({ width: 390, height: 844 });
  await openPanel(page);
  await expect(rail.getByText("Bài thảo luận đã sửa").first()).toBeVisible({ timeout: 30_000 });
  await shot(page, "document-discussion-mobile-vi");
});

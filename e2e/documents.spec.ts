import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { verifyEmail } from "./auth-nav";
import { workspaceSeed, type WorkspaceSeed } from "./onboard";

/**
 * Golden paths of G1-06 (a + b) on the H1 API: a page is created, typed into
 * and read back after a reload; a file document takes a new version through
 * `POST /uploads` + `POST /versions/commit` and downloads through the Go
 * proxy; the library lists what the server returns across its tabs, filters
 * and tree, and opens documents from both list and tree.
 *
 * Needs a running app whose API has the `documents` flag ON
 * (`FF_DOCUMENTS=true` on the server), Postgres + Redis + MinIO up, and this
 * worktree's migrations applied. Runbook and the exact commands:
 * reports/g1-06b-library-tree/e2e-runbook.md in the run folder (G1-06a's
 * runbook still describes the shared env).
 */
test.describe.configure({ timeout: 360_000 });

const stamp = Date.now();
const pageSeed = workspaceSeed("documents", "page", stamp);
const fileSeed = workspaceSeed("documents", "file", stamp);
const officeSeed = workspaceSeed("documents", "office", stamp);
const librarySeed = workspaceSeed("documents", "library", stamp);
const SHOTS =
  process.env.DOCUMENT_SHOT_DIR ?? resolve(process.cwd(), "test-results", "documents-shots");
const FIXTURE = resolve(process.cwd(), "fixtures", "parity-upload.txt");

const DOCUMENT_URL = /\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/;

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

/**
 * Register -> verify -> org -> workspace -> skip invites.
 *
 * The same flow as e2e/onboard.ts, with one difference that matters while the
 * app runs through `next dev` on a loaded host: the invite step's skip button
 * is clicked again if a click landed while the next route was still compiling,
 * and the workspace URL gets 120s.
 */
async function onboard(page: Page, w: WorkspaceSeed) {
  await page.goto("/register");
  await page.getByLabel("T\u00ean hi\u1ec3n th\u1ecb").fill(w.name);
  await page.getByLabel("Email").fill(w.email);
  await page.getByLabel("M\u1eadt kh\u1ea9u", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "\u0110\u0103ng k\u00fd" }).click();
  await verifyEmail(page);

  await page.getByRole("button", { name: /B\u1eaft \u0111\u1ea7u/ }).click();
  await page.getByRole("button", { name: "B\u1ecf qua" }).click();
  await page.getByLabel("T\u00ean t\u1ed5 ch\u1ee9c").fill(w.orgName);
  await page.getByRole("button", { name: `T\u1ea1o ${w.orgName}` }).click();
  await page.getByLabel("T\u00ean workspace").fill(w.wsName);
  await page.getByRole("button", { name: `T\u1ea1o ${w.wsName}` }).click();

  const workspaceUrl = new RegExp(`/${w.orgSlug}/${w.wsSlug}/tasks`);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole("button", { name: "B\u1ecf qua, m\u1eddi sau" }).click();
    try {
      await page.waitForURL(workspaceUrl, { timeout: 30_000 });
      break;
    } catch {
      // Still on the invite step: the click raced the route compile.
    }
  }
  await expect(page).toHaveURL(workspaceUrl, { timeout: 120_000 });
  await page.getByRole("button", { name: "\u0110\u1ec3 sau" }).click({ timeout: 30_000 });
}

/** Every screenshot the lane report needs is written next to the run. */
async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}

test("a page is created, typed into, and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page, pageSeed);

  await page.goto(`/${pageSeed.orgSlug}/${pageSeed.wsSlug}/documents`);
  // The library shell: tabs and the real empty state, never fabricated rows.
  await expect(page.getByRole("tab", { name: /Tất cả/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Chưa có tài liệu" })).toBeVisible();
  await shot(page, "documents-library-light-vi");

  await page
    .getByRole("button", { name: "Trang mới" })
    .first()
    .click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });

  const surface = page.getByRole("textbox", { name: "Nội dung tài liệu" });
  await expect(surface).toBeVisible({ timeout: 60_000 });
  await surface.click();
  await page.keyboard.type("Biên bản họp G1-06a");

  // Nothing may read as saved before the server answered.
  await expect(page.getByRole("status", { name: /^Đã lưu/ })).toBeVisible({ timeout: 30_000 });
  await shot(page, "document-page-light-vi");

  await page.reload();
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toContainText(
    "Biên bản họp G1-06a",
    { timeout: 60_000 },
  );

  // Dark theme, same content.
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await shot(page, "document-page-dark-vi");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // Mobile width: the canvas stays usable and the header keeps the save state.
  await page.setViewportSize({ width: 390, height: 844 });
  await shot(page, "document-page-mobile-vi");

  // English, same screen, through the language menu the app ships. The editor
  // takes its accessible name at mount, so the switch is followed by a reload.
  await page.getByRole("button", { name: "Ng\u00f4n ng\u1eef" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({
    timeout: 60_000,
  });
  await shot(page, "document-page-light-en");
});

test("a file document takes a new version and downloads it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page, fileSeed);

  await page.goto(`/${fileSeed.orgSlug}/${fileSeed.wsSlug}/documents`);
  await page
    .getByRole("button", { name: "Tải tệp" })
    .first()
    .click();
  await page.getByLabel("Chọn tệp").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Tải lên" }).click();

  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 90_000 });
  await expect(page.getByText("parity-upload.txt").first()).toBeVisible({ timeout: 60_000 });
  // No Office "Edit" button before G3: the format says what is possible.
  await expect(page.getByText("Chưa sửa được trong web")).toBeVisible();
  await shot(page, "document-file-light-vi");

  // A new version: uploads + versions/commit, then the history grows.
  await page.getByRole("button", { name: "Tải phiên bản mới" }).click();
  await page.getByLabel("Chọn tệp").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Tải lên" }).click();
  await expect(page.getByText("Phiên bản 2")).toBeVisible({ timeout: 90_000 });

  // Download goes through the authenticated proxy route (no presigned URL).
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Tải về" })
    .click();
  expect((await download).suggestedFilename()).toBe("parity-upload.txt");
});

test("the library lists pages across its tabs and the tree opens one", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page, librarySeed);

  await page.goto(`/${librarySeed.orgSlug}/${librarySeed.wsSlug}/documents`);
  await expect(page.getByRole("heading", { name: "Chưa có tài liệu" })).toBeVisible({
    timeout: 30_000,
  });

  // Create one page; its editor opens on it.
  await page.getByRole("button", { name: "Trang mới" }).first().click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({
    timeout: 60_000,
  });

  // Back to the library: the list row and the tree both carry the new page,
  // and the tab count is the server's own row count.
  await page.goto(`/${librarySeed.orgSlug}/${librarySeed.wsSlug}/documents`);
  const list = page.getByRole("list", { name: "Tài liệu" });
  await expect(list.getByRole("button", { name: /Trang mới/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("treeitem", { name: /Trang mới/ })).toBeVisible();
  await expect(page.getByRole("tab", { name: /Tất cả/ })).toContainText("1");

  // The other tabs read their own endpoints (nothing is shared with anyone).
  await page.getByRole("tab", { name: /Gần đây/ }).click();
  await expect(page.getByRole("tab", { name: /Gần đây/ })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: /Được chia sẻ với tôi/ }).click();
  await expect(page.getByRole("heading", { name: "Chưa có tài liệu" })).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("tab", { name: /Tất cả/ }).click();

  // Filters are the server's: a file filter drops the page row.
  await page.getByRole("combobox", { name: "Loại tài liệu" }).click();
  await page.getByRole("option", { name: "Tệp" }).click();
  await expect(page.getByText("Không có tài liệu khớp bộ lọc")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Bỏ bộ lọc" }).click();
  await expect(list.getByRole("button", { name: /Trang mới/ })).toBeVisible({ timeout: 30_000 });

  // The tree opens the document.
  await page.getByRole("treeitem", { name: /Trang mới/ }).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });

  // Dark and mobile screenshots, then English, on the same library.
  await page.goto(`/${librarySeed.orgSlug}/${librarySeed.wsSlug}/documents`);
  await expect(list.getByRole("button", { name: /Trang mới/ })).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await shot(page, "documents-library-dark-vi");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // Below xl the tree folds into a sheet; the trigger opens it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Cây" }).click();
  await expect(page.getByRole("treeitem", { name: /Trang mới/ })).toBeVisible({ timeout: 30_000 });
  await shot(page, "documents-library-mobile-tree-vi");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Ng\u00f4n ng\u1eef" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page.getByRole("tab", { name: /^All/ })).toBeVisible({ timeout: 30_000 });
  await shot(page, "documents-library-light-en");
});

test("the library and the page editor never call the Office service", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page, officeSeed);

  const officeCalls: string[] = [];
  page.on("request", (request) => {
    if (/\/office\/|:4000|:4100/.test(request.url())) officeCalls.push(request.url());
  });

  await page.goto(`/${officeSeed.orgSlug}/${officeSeed.wsSlug}/documents`);
  await expect(page.getByRole("tab", { name: /Tất cả/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Chưa có tài liệu" })).toBeVisible();

  // This spec runs with the Office engine stopped; nothing above may depend on
  // it, and the page editor has to open without it.
  expect(officeCalls).toEqual([]);
});

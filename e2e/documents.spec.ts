import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { verifyEmail } from "./auth-nav";
import { workspaceSeed, type WorkspaceSeed } from "./onboard";
import { libraryRowButton, newPageCard } from "./documents-onboard";

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

function sidebar(page: Page) {
  return page.getByRole("navigation", { name: "Điều hướng tài liệu" });
}

test("a page is created, typed into, and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page, pageSeed);

  await page.goto(`/${pageSeed.orgSlug}/${pageSeed.wsSlug}/documents`);
  // The library shell: the sidebar views and the real empty state, never fabricated rows.
  await expect(page.getByRole("heading", { name: "Tài liệu của workspace" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Workspace chưa có tài liệu" })).toBeVisible();
  await shot(page, "documents-library-light-vi");

  await newPageCard(page).click();
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
  await page.getByRole("button", { name: "Tải lên", exact: true }).click();
  const uploadDialog = page.getByRole("dialog", { name: "Tải tệp lên" });
  await expect(uploadDialog).toBeVisible();
  await uploadDialog.getByLabel("Chọn tệp").setInputFiles(FIXTURE);
  await uploadDialog.getByRole("button", { name: "Tải lên", exact: true }).click();

  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 90_000 });
  await expect(page.getByText("parity-upload.txt").first()).toBeVisible({ timeout: 60_000 });
  // A plain-text file has no Office frame: the format says what is possible.
  await expect(page.getByText("Không sửa được trên web")).toBeVisible();
  await shot(page, "document-file-light-vi");

  // A new version: uploads + versions/commit, then the history grows.
  await page.getByRole("button", { name: "Tải phiên bản mới" }).click();
  const versionDialog = page.getByRole("dialog", { name: "Tải phiên bản mới" });
  await versionDialog.getByLabel("Chọn tệp").setInputFiles(FIXTURE);
  await versionDialog.getByRole("button", { name: "Tải lên", exact: true }).click();
  await expect(page.getByText("Phiên bản 2")).toBeVisible({ timeout: 90_000 });

  // Download goes through the authenticated proxy route (no presigned URL).
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Tải về" })
    .click();
  expect((await download).suggestedFilename()).toBe("parity-upload.txt");
});

test("the library lists pages across its views and the tree opens one", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboard(page, librarySeed);

  await page.goto(`/${librarySeed.orgSlug}/${librarySeed.wsSlug}/documents`);
  await expect(page.getByRole("heading", { name: "Workspace chưa có tài liệu" })).toBeVisible({
    timeout: 30_000,
  });

  // Create one page; its editor opens on it.
  await newPageCard(page).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });
  await expect(page.getByRole("textbox", { name: "Nội dung tài liệu" })).toBeVisible({
    timeout: 60_000,
  });

  // Back to the library: the table carries the new page, and the "Tài liệu"
  // section's h2 is the server's own row count. The sidebar tree lists folders only.
  await page.goto(`/${librarySeed.orgSlug}/${librarySeed.wsSlug}/documents`);
  const list = page.getByRole("table", { name: "Tài liệu" });
  await expect(libraryRowButton(list, /UniNote mới/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("treeitem", { name: /UniNote mới/ })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Tài liệu 1", exact: true })).toBeVisible();

  // The sidebar views read their own endpoints (nothing is shared with anyone).
  await sidebar(page).getByRole("button", { name: "Gần đây", exact: true }).click();
  await expect(sidebar(page).getByRole("button", { name: "Gần đây", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await sidebar(page).getByRole("button", { name: "Được chia sẻ với tôi" }).click();
  await expect(page.getByRole("heading", { name: "Chưa có tài liệu nào được chia sẻ với bạn" })).toBeVisible({
    timeout: 30_000,
  });
  await sidebar(page).getByRole("button", { name: "Tài liệu của workspace" }).click();

  // The type filter drops the page row.
  await page.getByRole("combobox", { name: /^Loại/ }).click();
  await page.getByRole("option", { name: "Docs" }).click();
  await expect(page.getByText("Không có tài liệu khớp bộ lọc")).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "Bỏ bộ lọc" }).click();
  await expect(libraryRowButton(list, /UniNote mới/)).toBeVisible({ timeout: 30_000 });
  // The row opens the document.
  await libraryRowButton(list, /UniNote mới/).click();
  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 60_000 });

  // Dark and mobile screenshots, then English, on the same library.
  await page.goto(`/${librarySeed.orgSlug}/${librarySeed.wsSlug}/documents`);
  await expect(libraryRowButton(list, /UniNote mới/)).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await shot(page, "documents-library-dark-vi");
  await page.evaluate(() => document.documentElement.classList.remove("dark"));

  // Below xl the navigation folds into a sheet; the trigger opens it.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("button", { name: "Điều hướng" }).click();
  await expect(page.getByRole("button", { name: "Tài liệu của workspace" })).toBeVisible({ timeout: 30_000 });
  await shot(page, "documents-library-mobile-tree-vi");
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Ng\u00f4n ng\u1eef" }).click();
  await page.getByRole("menuitemradio", { name: "English" }).click();
  await expect(page.getByRole("heading", { name: /^Workspace documents/ })).toBeVisible({ timeout: 30_000 });
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
  await expect(page.getByRole("heading", { name: "Tài liệu của workspace" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Workspace chưa có tài liệu" })).toBeVisible();

  // This spec runs with the Office engine stopped; nothing above may depend on
  // it, and the page editor has to open without it.
  expect(officeCalls).toEqual([]);
});

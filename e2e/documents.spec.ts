import { expect, test, type Page } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { onboardToWorkspace, workspaceSeed } from "./onboard";

/**
 * Golden path of G1-06a on the H1 API: a page is created, typed into and read
 * back after a reload; a file document takes a new version through
 * `POST /uploads` + `POST /versions/commit` and downloads through the Go
 * proxy.
 *
 * Needs a running app whose API has the `documents` flag ON
 * (`FF_DOCUMENTS=true` on the server), Postgres + Redis + MinIO up, and this
 * worktree's migrations applied. Runbook and the exact commands:
 * reports/g1-06a-page-editor/e2e-runbook.md in the run folder.
 */
test.describe.configure({ timeout: 240_000 });

const stamp = Date.now();
const pageSeed = workspaceSeed("documents", "page", stamp);
const fileSeed = workspaceSeed("documents", "file", stamp);
const officeSeed = workspaceSeed("documents", "office", stamp);
const SHOTS =
  process.env.DOCUMENT_SHOT_DIR ?? resolve(process.cwd(), "test-results", "documents-shots");
const FIXTURE = resolve(process.cwd(), "fixtures", "parity-upload.txt");

const DOCUMENT_URL = /\/documents\/[0-9A-HJKMNP-TV-Z]{26}$/;

test.beforeAll(() => {
  mkdirSync(SHOTS, { recursive: true });
});

/** Every screenshot the lane report needs is written next to the run. */
async function shot(page: Page, name: string) {
  await page.screenshot({ path: resolve(SHOTS, `${name}.png`) });
}

test("a page is created, typed into, and survives a reload", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboardToWorkspace(page, pageSeed);

  await page.goto(`/${pageSeed.orgSlug}/${pageSeed.wsSlug}/documents`);
  // The entry screen of G1-06a: create or upload, no library list yet.
  await expect(page.getByRole("heading", { name: "Tài liệu", level: 1 })).toBeVisible();
  await expect(page.getByText("Thư viện tài liệu chưa mở")).toBeVisible();
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
  await expect(page.getByText(/^Đã lưu/)).toBeVisible({ timeout: 30_000 });
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

  // English, same screen.
  await page.context().addCookies([{ name: "uniwork-locale", value: "en", url: page.url() }]);
  await page.reload();
  await expect(page.getByRole("textbox", { name: "Document content" })).toBeVisible({
    timeout: 60_000,
  });
  await shot(page, "document-page-light-en");
});

test("a file document takes a new version and downloads it", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboardToWorkspace(page, fileSeed);

  await page.goto(`/${fileSeed.orgSlug}/${fileSeed.wsSlug}/documents`);
  await page
    .getByRole("button", { name: "Tải tệp" })
    .first()
    .click();
  await page.getByLabel("Chọn tệp").setInputFiles(FIXTURE);
  await page.getByRole("button", { name: "Tải lên" }).click();

  await expect(page).toHaveURL(DOCUMENT_URL, { timeout: 90_000 });
  await expect(page.getByText("parity-upload.txt")).toBeVisible({ timeout: 60_000 });
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

test("the library and the page editor never call the Office service", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await onboardToWorkspace(page, officeSeed);

  const officeCalls: string[] = [];
  page.on("request", (request) => {
    if (/\/office\/|:4000|:4100/.test(request.url())) officeCalls.push(request.url());
  });

  await page.goto(`/${officeSeed.orgSlug}/${officeSeed.wsSlug}/documents`);
  await expect(page.getByText("Thư viện tài liệu chưa mở")).toBeVisible();

  // This spec runs with the Office engine stopped; nothing above may depend on
  // it, and the page editor has to open without it.
  expect(officeCalls).toEqual([]);
});

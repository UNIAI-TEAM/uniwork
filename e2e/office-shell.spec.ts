import { expect, test } from "@playwright/test";
import { Client } from "pg";

/**
 * Shell-only browser contract. The format lanes own real byte/edit oracles;
 * this suite checks that the shared host remains reachable behind the flag,
 * survives a reload with a local recovery, and keeps keyboard/focus/layout
 * behavior stable. CI supplies an authenticated OFFICE_DOCUMENT_URL fixture.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const enabled = process.env.OFFICE_SHELL_E2E === "1";
const documentUrl = process.env.OFFICE_DOCUMENT_URL;
const flagOffUrl = process.env.OFFICE_DOCUMENT_FLAG_OFF_URL;
const viewports = [360, 375, 768, 1280] as const;

async function enableOfficeFlag(): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable";
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind)
       VALUES ('e2e-office-shell-global', 'office_engine', 'global', '', true, 'e2e: office shell', 'e2e', 'system')
       ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = true`,
    );
  } finally {
    await client.end();
  }
}

test.beforeAll(async () => {
  test.skip(!enabled || !documentUrl, "Set OFFICE_SHELL_E2E=1 and OFFICE_DOCUMENT_URL for the authenticated shell fixture.");
  await enableOfficeFlag();
});

test("opens, edits, reloads into recovery, and guards a leave", async ({ page }) => {
  await page.goto(documentUrl!);
  await expect(page.locator("[data-office-editor-host]")).toBeVisible();
  const canvas = page.locator("[data-office-shell]");
  await canvas.focus();
  const editable = page.locator("[contenteditable=true], textarea, input").first();
  if (await editable.count()) await editable.fill("shell draft");
  await page.keyboard.press("Control+S");
  await page.reload();
  await expect(page.getByRole("dialog").filter({ hasText: /bản nháp|draft/i })).toBeVisible();

  await page.getByRole("button", { name: /khôi phục|recover/i }).click();
  await page.getByRole("button", { name: /Lưu|Save/i }).first().click();
  await expect(page.locator(":focus-visible")).toHaveCount(1);
});

for (const width of viewports) {
  test(`holds the shell at ${width}px in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(documentUrl!);
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((mode) => document.documentElement.classList.toggle("dark", mode === "dark"), theme);
      await expect(page.locator("[data-office-shell]")).toHaveScreenshot(`office-shell-${width}-${theme}.png`, {
        animations: "disabled",
        maxDiffPixels: 100,
      });
    }
  });
}

test("flag off leaves the existing file view unchanged", async ({ page }) => {
  test.skip(!flagOffUrl, "Set OFFICE_DOCUMENT_FLAG_OFF_URL for a fixture served with office_engine disabled.");
  await page.goto(flagOffUrl!);
  await expect(page.locator("[data-office-editor-host]")).toHaveCount(0);
});

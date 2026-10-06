import { expect, test, type Browser, type Page } from "@playwright/test";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { createRecordingAccount } from "./meeting-recording-fixture";
import { VI_LOCALE_STATE } from "./locale-state";

/**
 * Shell-only browser contract. The format lanes own real byte/edit oracles;
 * this suite checks that the shared host remains reachable behind the flag,
 * survives a reload with a local recovery, and keeps keyboard/focus/layout
 * behavior stable. CI supplies an authenticated OFFICE_DOCUMENT_URL fixture.
 */
test.describe.configure({ mode: "serial", timeout: 120_000 });

const enabled = process.env.OFFICE_SHELL_E2E === "1";
const suppliedDocumentUrl = process.env.OFFICE_DOCUMENT_URL;
const suppliedFlagOffUrl = process.env.OFFICE_DOCUMENT_FLAG_OFF_URL;
const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";
const baseUrl = process.env.E2E_BASE_URL ?? "http://localhost:3000";
// `pnpm --filter @uniwork/e2e test` runs with e2e/ as cwd while a root
// Playwright invocation runs from the repository root; keep the fixture pin
// stable for both supported local-stack entry points.
const repoRoot = basename(process.cwd()).toLowerCase() === "e2e" ? resolve(process.cwd(), "..") : process.cwd();
const fixturePath = resolve(repoRoot, "docs/office/g0/fixtures/files/docs/docx-kitchen-sink.docx");
const viewports = [360, 375, 768, 1280] as const;

interface OfficeFixture {
  documentUrl: string;
  flagOffUrl: string;
  email: string;
}

let officeFixture: OfficeFixture | null = null;

async function setOfficeFlag(enabled: boolean): Promise<void> {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL ?? "postgres://uniwork:uniwork@localhost:5432/uniwork?sslmode=disable";
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query(
      `INSERT INTO feature_flag_overrides (id, flag_key, scope_type, scope_id, enabled, note, created_by, created_by_kind)
       VALUES ('e2e-office-shell-global', 'office_engine', 'global', '', $1, 'e2e: office shell', 'e2e', 'system')
       ON CONFLICT (flag_key, scope_type, scope_id) DO UPDATE SET enabled = $1`,
      [enabled],
    );
  } finally {
    await client.end();
  }
}

async function seedOfficeFixture(browser: Browser): Promise<OfficeFixture> {
  const context = await browser.newContext({ storageState: VI_LOCALE_STATE, baseURL: baseUrl });
  const page = await context.newPage();
  try {
    const account = await createRecordingAccount(page, apiUrl, `office-shell-${Date.now().toString(36)}`);
    const bytes = readFileSync(fixturePath);
    const response = await page.request.post(`${apiUrl}/api/v1/workspaces/${account.wsId}/documents/files`, {
      headers: {
        authorization: `Bearer ${account.token}`,
        "Idempotency-Key": `office-shell-${Date.now().toString(36)}`,
      },
      multipart: {
        file: {
          name: "office-shell.docx",
          mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          buffer: bytes,
        },
      },
    });
    expect(response.ok(), `seed Office file: HTTP ${response.status()} ${await response.text()}`).toBeTruthy();
    const payload = (await response.json()) as { document?: { id: string } };
    expect(payload.document?.id, "seed Office file returned no document id").toBeTruthy();
    const documentUrl = `${baseUrl}/${account.orgSlug}/${account.wsSlug}/documents/${payload.document!.id}`;
    return {
      documentUrl,
      flagOffUrl: `${documentUrl}?office_flag=off`,
      email: account.email,
    };
  } finally {
    await context.close();
  }
}

async function signIn(page: Page, email: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Mật khẩu", { exact: true }).fill("password123");
  await page.getByRole("button", { name: "Đăng nhập" }).click();
  await expect(page).not.toHaveURL(/\/login/, { timeout: 60_000 });
}

async function installFlagOffConfig(page: Page): Promise<void> {
  await page.route("**/api/v1/config", async (route) => {
    const response = await route.fetch();
    if (!response.ok()) {
      await route.fulfill({ response });
      return;
    }
    const body = (await response.json()) as { flags?: Record<string, boolean> };
    await route.fulfill({
      response,
      body: JSON.stringify({ ...body, flags: { ...body.flags, office_engine: false } }),
    });
  });
}

test.beforeAll(async ({ browser }) => {
  test.skip(!enabled, "Set OFFICE_SHELL_E2E=1 to run the local Office shell browser contract.");
  await setOfficeFlag(true);
  officeFixture = suppliedDocumentUrl
    ? { documentUrl: suppliedDocumentUrl, flagOffUrl: suppliedFlagOffUrl ?? suppliedDocumentUrl, email: "" }
    : await seedOfficeFixture(browser);
});

test.beforeEach(async ({ page }) => {
  if (officeFixture?.email) await signIn(page, officeFixture.email);
});

test("real-engine edit, reload, and recovery is deferred to 0Xb", async () => {
  test.skip(true, "0Xb owns the real-engine edit -> reload -> recovery path; 03b covers the unbound shell and browser chrome.");
});

test("keeps bound Office header actions reachable at 390px without nested scrolling", async ({ page }) => {
  test.skip(!process.env.OFFICE_HEADER_DOCUMENT_URL, "Supply an authenticated bound Office editor to verify real header actions.");
  if (process.env.OFFICE_HEADER_STORAGE_STATE) {
    const state = JSON.parse(readFileSync(process.env.OFFICE_HEADER_STORAGE_STATE, "utf8")) as { cookies: Parameters<ReturnType<typeof page.context>["addCookies"]>[0]; origins: { origin: string; localStorage: { name: string; value: string }[] }[] };
    await page.context().addCookies(state.cookies);
    await page.addInitScript((origins) => {
      for (const origin of origins) if (origin.origin === location.origin) {
        for (const item of origin.localStorage) localStorage.setItem(item.name, item.value);
      }
    }, state.origins ?? []);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(process.env.OFFICE_HEADER_DOCUMENT_URL!);
  const shell = page.locator("[data-office-shell]");
  const header = shell.locator(":scope > header");
  await expect(header.locator("button").first()).toBeVisible();
  for (const theme of ["light", "dark"] as const) {
    await page.evaluate(mode => document.documentElement.classList.toggle("dark", mode === "dark"), theme);
    const layout = await header.evaluate(element => ({
      actionBounds: [...element.querySelectorAll("button")].map(button => ({ left: button.getBoundingClientRect().left, right: button.getBoundingClientRect().right })),
      scrollers: [...element.querySelectorAll("div")].filter(div => ["auto", "scroll"].includes(getComputedStyle(div).overflowX)).length,
      followingBandEmpty: element.nextElementSibling?.textContent?.trim() === "",
    }));
    expect(layout.actionBounds.length).toBeGreaterThan(0);
    for (const bounds of layout.actionBounds) { expect(bounds.left).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(390); }
    expect(layout.scrollers).toBe(0);
    expect(layout.followingBandEmpty).toBe(false);
    await shell.screenshot({ path: test.info().outputPath(`office-header-390-${theme}.png`) });
  }
});

for (const width of viewports) {
  test(`holds the shell at ${width}px in both themes`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(officeFixture!.documentUrl);
    await expect(page.locator("[data-office-editor-host]")).toBeVisible();
    await expect(page.getByTestId("office-host-unbound")).toBeVisible();
    const shell = page.locator("[data-office-shell]");
    await expect(shell).toBeVisible();
    const bounds = await shell.boundingBox();
    expect(bounds?.width ?? 0).toBeGreaterThan(0);
    expect(bounds?.height ?? 0).toBeGreaterThan(0);
    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((mode) => document.documentElement.classList.toggle("dark", mode === "dark"), theme);
      await page.evaluate(() => document.fonts?.ready);
      await expect(shell).toHaveScreenshot(`office-shell-${width}-${theme}.png`, {
        animations: "disabled",
        maxDiffPixels: 120,
      });
    }
  });
}

test("keyboard-only navigation keeps focus visible on the unbound shell", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(officeFixture!.documentUrl);
  await expect(page.getByTestId("office-host-unbound")).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.locator(":focus-visible")).toHaveCount(1);
  await expect(page.locator(":focus-visible")).toBeVisible();
});

test("flag off leaves the existing file view unchanged", async ({ page }) => {
  test.skip(!officeFixture, "The Office shell fixture was not created; run with OFFICE_SHELL_E2E=1.");
  if (!suppliedFlagOffUrl && officeFixture?.email) {
    // Start a fresh app tree so the React Query config cache from beforeEach
    // cannot carry the enabled flag into the off fixture.
    await page.goto("about:blank");
    await installFlagOffConfig(page);
    await signIn(page, officeFixture.email);
  }
  await page.goto(officeFixture!.flagOffUrl);
  await expect(page.locator("[data-office-editor-host]")).toHaveCount(0);
  await expect(page.getByText(/Chưa sửa được trong web|Not editable in web/i)).toBeVisible();
});

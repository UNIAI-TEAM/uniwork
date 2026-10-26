import { expect, test, type Page } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { auditText } from "./contrast";
import { checkActiveFocusIndicator, checkActiveFocusRingContrast } from "./focus";
import { createRecordingAccount, loginViaUi } from "./meeting-recording-fixture";

/**
 * UNI-2198 (Q1): Google Drive connector E2E on the real server + production web
 * build with the fake OAuth provider (`DRIVE_FAKE_PROVIDER=1`) and fake Picker
 * (`NEXT_PUBLIC_DRIVE_FAKE_PICKER=1` + `window.__UNIWORK_FAKE_DRIVE_PICKER__`).
 *
 * Requires:
 * - Server: `DRIVE_FAKE_PROVIDER=1`, `DRIVE_CREDENTIAL_KEY` (base64 32 bytes),
 *   `FF_DRIVE_CONNECTOR=true` (or global DB override from `documents-flag.setup.ts`).
 * - Web build: `NEXT_PUBLIC_DRIVE_FAKE_PICKER=1` baked at `next build`.
 */
test.describe.configure({ timeout: 240_000 });

async function setMode(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
}

async function signInAndOpenSettingsIntegrations(page: Page, tag: string) {
  const account = await createRecordingAccount(page, e2eApiUrl, tag);
  await loginViaUi(page, account.email);
  await page.goto(`/${account.orgSlug}/${account.wsSlug}/settings?tab=integrations`);
  await expect(page.getByRole("heading", { name: "Tích hợp" })).toBeVisible({ timeout: 30_000 });
  return account;
}

test("1. User A connects Google Drive in Settings › Integrations through the fake OAuth; the account shows as connected", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAndOpenSettingsIntegrations(page, "drive-q1-connect");

  const row = page.getByTestId("drive-integration-row");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText("Chưa kết nối")).toBeVisible();
  await expect(row.getByText("Mới")).toBeVisible();

  await row.getByRole("button", { name: "Kết nối Google Drive" }).click();

  const view = page.getByTestId("drive-integration-view");
  await expect(view).toBeVisible({ timeout: 30_000 });
  await expect(page).toHaveURL(/tab=integrations&integration=drive/, { timeout: 15_000 });
  await expect(
    view.getByText("Đã kết nối Google Drive. Bạn có thể liên kết tài liệu vào việc."),
  ).toBeVisible({ timeout: 15_000 });
  await expect(view.getByText(/drive-fake-.*@example\.com/)).toBeVisible();
  await expect(view.getByText("Đang hoạt động")).toBeVisible();
  await expect(view.getByText("Chỉ tệp bạn chọn")).toBeVisible();
  await expect(view.getByText("Chỉ liên kết, không lưu nội dung")).toBeVisible();
  await expect(view.getByText("UNI được làm gì với tài liệu đã liên kết")).toBeVisible();

  // Returning to the Integrations list shows the row as connected with "Quản lý".
  await view.getByRole("navigation", { name: "Tích hợp" }).getByRole("button", { name: "Tích hợp" }).click();
  await expect(row).toBeVisible({ timeout: 15_000 });
  await expect(row.getByText("Đã kết nối 1 tài khoản")).toBeVisible();
  await expect(row.getByRole("button", { name: "Quản lý" })).toBeVisible();
});

test("2. User A links a Drive file from the create-task dialog (paperclip / Attach -> fake Picker picked) and the task shows the Drive card", async ({
  page,
}) => {
  test.fixme(
    true,
    "Missing backend routes POST /drive-connections/{id}/picker-token, POST /workspaces/{ws}/drive-files, CreateTaskSDI.drive_files, and GET /tasks/{taskID}/drive-files (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  // Steps once the card lands:
  // Sign in as A, open the create-task dialog and install the fake Picker (window.__UNIWORK_FAKE_DRIVE_PICKER__).
  // Open the paperclip / Attach menu, choose Google Drive and pick the fake file.
  // Submit the task; expect the create request to carry drive_files.
  // Open the new task and expect the Drive card with the file name.
  await page.goto("/");
});

test("3. Documents › Google Drive (4.1) for A lists that file (all accounts + the account view); the sidebar Google Drive section shows", async ({
  page,
}) => {
  test.fixme(
    true,
    "Missing backend route GET /api/v1/workspaces/{workspaceID}/drive-files and POST /drive-files to link a file (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  // Steps once the card lands:
  // Link a Drive file for A (through the task dialog or the API).
  // Open Documents > Google Drive (4.1); expect the file in the all-accounts list.
  // Switch to the single-account view; expect the same file.
  // Expect the sidebar Google Drive section to be visible.
  await page.goto("/");
});

test("4. User B (same workspace, no connection): sees the file on the task card as unknown/no access per §7.10, and B's 4.1 shows none of A's files (empty state)", async ({
  page,
}) => {
  test.fixme(
    true,
    "Missing backend routes GET /api/v1/tasks/{taskID}/drive-files and GET /api/v1/workspaces/{workspaceID}/drive-files (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  // Steps once the card lands:
  // As A, link a file to a task; register B in the same workspace without a Drive connection.
  // Open the task as B; expect the card in the unknown / no-access state (spec 7.10).
  // Open Documents > Google Drive (4.1) as B; expect the empty state with none of A's files.
  await page.goto("/");
});

test("5. A unlinks at the 4.2 file page; the card on the already-open task page refreshes without reload (realtime/query invalidation), file gone from 4.1", async ({
  page,
}) => {
  test.fixme(
    true,
    "Missing backend routes GET/DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID} and drive_file.unlinked outbox emission (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  // Steps once the card lands:
  // As A, open the task page and keep it open; open the 4.2 file page in a second tab.
  // Unlink the file on 4.2.
  // Expect the card on the open task page to disappear without a reload (drive_file.unlinked invalidation).
  // Expect the file gone from 4.1.
  await page.goto("/");
});

test("6a. Contrast + focus on Settings › Integrations Drive row and connected view (1.1, 1.3), and the Picker trigger in the create-task dialog, light + dark", async ({
  page,
}) => {
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await signInAndOpenSettingsIntegrations(page, "drive-q1-a11y");

  const row = page.getByTestId("drive-integration-row");
  await expect(row).toBeVisible({ timeout: 20_000 });

  // 1.1 Unconnected Drive row in Settings › Integrations (light + dark contrast & focus)
  for (const mode of ["light", "dark"] as const) {
    await setMode(page, mode);
    const contrast = await auditText(page, '[data-testid="drive-integration-row"]');
    expect(contrast.colorLevel4, "browser canvas must support CSS Color 4").toBe(true);
    expect(contrast.checked, `1.1 row checked nodes (${mode})`).toBeGreaterThan(2);
    expect(contrast.fails, `1.1 row contrast (${mode}): ${contrast.fails.join(" | ")}`).toEqual([]);
  }
  const connectBtn = row.getByRole("button", { name: "Kết nối Google Drive" });
  await connectBtn.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  for (const mode of ["light", "dark"] as const) {
    await setMode(page, mode);
    const focusInfo = await checkActiveFocusIndicator(page);
    expect(focusInfo?.ok, `1.1 connect button focus indicator (${mode})`).toBe(true);
    const ringBad = await checkActiveFocusRingContrast(page);
    expect(ringBad, `1.1 connect button focus ring contrast (${mode})`).toBeNull();
  }

  // Connect via fake OAuth -> 1.3 Connected Drive view
  await connectBtn.click();
  const view = page.getByTestId("drive-integration-view");
  await expect(view).toBeVisible({ timeout: 30_000 });
  await expect(view.getByText(/drive-fake-.*@example\.com/)).toBeVisible();

  for (const mode of ["light", "dark"] as const) {
    await setMode(page, mode);
    const contrast = await auditText(page, '[data-testid="drive-integration-view"]');
    expect(contrast.checked, `1.3 view checked nodes (${mode})`).toBeGreaterThan(10);
    expect(contrast.fails, `1.3 view contrast (${mode}): ${contrast.fails.join(" | ")}`).toEqual([]);

    const bare: string[] = [];
    const offenders: string[] = [];
    await view.getByRole("heading", { name: "Google Drive", level: 2 }).focus();
    for (let i = 0; i < 6; i += 1) {
      await page.keyboard.press("Tab");
      const info = await checkActiveFocusIndicator(page);
      if (info && !info.ok) bare.push(info.what);
      const bad = await checkActiveFocusRingContrast(page);
      if (bad) offenders.push(bad);
    }
    expect(bare, `1.3 view missing focus indicator (${mode}): ${bare.join(", ")}`).toEqual([]);
    expect(offenders, `1.3 view focus ring < 3:1 (${mode}): ${offenders.join(" | ")}`).toEqual([]);
  }

  // Picker trigger (paperclip menu + "Từ Google Drive" item) in the create-task dialog
  await page.goto(`/${account.orgSlug}/${account.wsSlug}/tasks`);
  await page.getByRole("button", { name: "Tạo việc", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  const attachTrigger = dialog.getByRole("button", { name: "Đính kèm tệp" });
  await expect(attachTrigger).toBeVisible();
  await attachTrigger.focus();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Tab");
  for (const mode of ["light", "dark"] as const) {
    await setMode(page, mode);
    const focusInfo = await checkActiveFocusIndicator(page);
    expect(focusInfo?.ok, `Picker paperclip trigger focus indicator (${mode})`).toBe(true);
    const ringBad = await checkActiveFocusRingContrast(page);
    expect(ringBad, `Picker paperclip trigger focus ring contrast (${mode})`).toBeNull();
  }

  await attachTrigger.click();
  await expect(page.getByRole("menuitem", { name: /Từ Google Drive/ })).toBeVisible();
  for (const mode of ["light", "dark"] as const) {
    await setMode(page, mode);
    const menuContrast = await auditText(page, '[role="menu"]');
    expect(menuContrast.checked, `Picker attach menu checked nodes (${mode})`).toBeGreaterThan(2);
    expect(
      menuContrast.fails,
      `Picker attach menu contrast (${mode}): ${menuContrast.fails.join(" | ")}`,
    ).toEqual([]);
  }
});

test("6b. Contrast + focus on Documents › Google Drive (4.1) and the Drive file detail page (4.2), light + dark", async ({
  page,
}) => {
  test.fixme(
    true,
    "Missing backend routes GET /api/v1/workspaces/{workspaceID}/drive-files and GET /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID} needed for 4.1 and 4.2 to render beyond their error state (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  // Steps once the card lands:
  // Link a file for A so 4.1 and 4.2 render real content.
  // For light and dark: open 4.1, run auditText and the focus checks.
  // Open the 4.2 file detail page and repeat the contrast and focus checks.
  // Expect no contrast failures and a visible focus indicator.
  await page.goto("/");
});

// === Part 2 placeholders (after B5/B6 + W6/W7 land) ===

test("Part 2 — agent mode sends a Drive file -> proposals", async ({ page }) => {
  test.fixme(
    true,
    "Awaiting B5 (UNI-2181 POST /drive-files/{id}/task-proposals) and W6 (UNI-2190 agent mode + popover proposal trigger)",
  );
  // Steps once the card lands:
  // Link a Drive file and open its popover.
  // Switch to agent mode and send the file to the agent.
  // Expect task proposals to be returned and listed.
  await page.goto("/");
});

test("Part 2 — proposal review dialog", async ({ page }) => {
  test.fixme(
    true,
    "Awaiting B5/B6 (UNI-2181/UNI-2182 proposal endpoints) and W7 (UNI-2191 Drive proposal review dialog)",
  );
  // Steps once the card lands:
  // Produce proposals from a linked Drive file.
  // Open the proposal review dialog.
  // Expect each proposal with editable fields and accept / skip controls.
  await page.goto("/");
});

test("Part 2 — batch create tasks from Drive proposal", async ({ page }) => {
  test.fixme(
    true,
    "Awaiting B6 (UNI-2182 POST /drive-task-proposals/{id}/tasks) and W7 (UNI-2191 review dialog batch creation + toast)",
  );
  // Steps once the card lands:
  // Open the review dialog with proposals.
  // Select proposals and confirm the batch create.
  // Expect the tasks created and the success toast.
  await page.goto("/");
});

test("Part 2 — second-create warning when tasks were already created from the document", async ({
  page,
}) => {
  test.fixme(
    true,
    "Awaiting B6 (UNI-2182 tasks_created + prior_creations) and W6/W7 (UNI-2190/UNI-2191 recreate warning)",
  );
  // Steps once the card lands:
  // Create tasks from a document once.
  // Create from the same document again.
  // Expect the warning listing the prior creations before confirming.
  await page.goto("/");
});

test("Part 2 — 'Tasks created' block on 4.2 Drive file detail page", async ({ page }) => {
  test.fixme(
    true,
    "Awaiting B4/B6 (UNI-2180/UNI-2182 GET /drive-files/{id} with task_creations populated after batch conversion)",
  );
  // Steps once the card lands:
  // Create tasks from a Drive proposal in a batch.
  // Open the 4.2 file detail page.
  // Expect the 'Tasks created' block listing the new tasks.
  await page.goto("/");
});

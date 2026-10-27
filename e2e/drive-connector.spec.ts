import { expect, test, type Page } from "@playwright/test";
import { e2eApiUrl } from "./api-url";
import { auditText } from "./contrast";
import { checkActiveFocusIndicator, checkActiveFocusRingContrast } from "./focus";
import { VI_LOCALE_STATE } from "./locale-state";
import {
  createRecordingAccount,
  joinWorkspaceAsMember,
  loginViaUi,
  registerApiUser,
} from "./meeting-recording-fixture";

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
const B4_ON_ROOT = false; // flip to true when UNI-2180 (B4 drive-files routes) is on the root
// Drive-be's fake files.get (DRIVE_FAKE_PROVIDER=1) echoes the external id as the file name; change here if its fake changes.
const fakeDriveName = (externalFileId: string) => externalFileId;

interface FakeDriveSeedFile {
  id: string;
  name: string;
  mimeType: string;
  sharingState: "private" | "shared" | "unknown";
}

async function setMode(page: Page, mode: "light" | "dark") {
  await page.evaluate((m) => document.documentElement.classList.toggle("dark", m === "dark"), mode);
}

async function installFakeDrivePicker(page: Page, files: FakeDriveSeedFile[]) {
  await page.addInitScript((picked) => {
    Reflect.set(window, "__UNIWORK_FAKE_DRIVE_PICKER__", picked);
  }, files);
  await page.evaluate((picked) => {
    Reflect.set(window, "__UNIWORK_FAKE_DRIVE_PICKER__", picked);
  }, files);
}

function isCreateTaskPost(url: string, method: string): boolean {
  if (method !== "POST") return false;
  try {
    const { pathname } = new URL(url);
    return /\/api\/v1\/workspaces\/[^/]+\/tasks$/.test(pathname);
  } catch {
    return false;
  }
}

async function signInAndOpenSettingsIntegrations(page: Page, tag: string) {
  const account = await createRecordingAccount(page, e2eApiUrl, tag);
  await loginViaUi(page, account.email);
  await page.goto(`/${account.orgSlug}/${account.wsSlug}/settings?tab=integrations`);
  await expect(page.getByRole("heading", { name: "Tích hợp" })).toBeVisible({ timeout: 30_000 });
  return account;
}

async function connectDriveForCurrentUser(page: Page) {
  const row = page.getByTestId("drive-integration-row");
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "Kết nối Google Drive" }).click();

  const view = page.getByTestId("drive-integration-view");
  await expect(view).toBeVisible({ timeout: 30_000 });
  await expect(
    view.getByText("Đã kết nối Google Drive. Bạn có thể liên kết tài liệu vào việc."),
  ).toBeVisible({ timeout: 15_000 });
  const emailLocator = view.getByText(/drive-fake-.*@example\.com/).first();
  await expect(emailLocator).toBeVisible();
  const googleEmail = (await emailLocator.textContent())?.trim() ?? "";
  return { googleEmail };
}

async function createTaskWithFakeDriveFile(
  page: Page,
  orgSlug: string,
  wsSlug: string,
  taskTitle: string,
  file: FakeDriveSeedFile,
): Promise<{ taskId: string; taskIdentifier: string }> {
  await installFakeDrivePicker(page, [file]);
  await page.goto(`/${orgSlug}/${wsSlug}/tasks`);
  await page.getByRole("button", { name: "Tạo việc", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible({ timeout: 15_000 });

  await dialog.getByRole("button", { name: "Đính kèm tệp" }).click();
  const pickerTokenRes = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      /\/api\/v1\/workspaces\/[^/]+\/drive-connections\/[^/]+\/picker-token$/.test(
        new URL(r.url()).pathname,
      ),
    { timeout: 15_000 },
  );
  await page.getByRole("menuitem", { name: /Từ Google Drive/ }).click();
  const tokenResp = await pickerTokenRes;
  expect(tokenResp.ok(), await tokenResp.text()).toBeTruthy();

  const chip = dialog.getByTestId(`create-task-drive-chip-${file.id}`);
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(chip).toContainText(file.name);

  await dialog.getByPlaceholder("Tiêu đề issue").fill(taskTitle);
  const createResPromise = page.waitForResponse(
    (r) => isCreateTaskPost(r.url(), r.request().method()),
    { timeout: 20_000 },
  );
  await dialog.getByRole("button", { name: "Tạo", exact: true }).click();
  const createRes = await createResPromise;
  expect(createRes.ok(), await createRes.text()).toBeTruthy();

  const postedBody: unknown = createRes.request().postDataJSON();
  expect(postedBody).toEqual(
    expect.objectContaining({
      drive_files: [
        expect.objectContaining({
          connection_id: expect.any(String),
          external_file_id: file.id,
        }),
      ],
    }),
  );

  const createdRaw: unknown = await createRes.json();
  expect(createdRaw).toEqual(
    expect.objectContaining({
      task: expect.objectContaining({
        id: expect.any(String),
        identifier: expect.any(String),
      }),
    }),
  );
  const taskObj =
    createdRaw && typeof createdRaw === "object" && "task" in createdRaw && createdRaw.task && typeof createdRaw.task === "object"
      ? createdRaw.task
      : null;
  const taskId = taskObj && "id" in taskObj && typeof taskObj.id === "string" ? taskObj.id : "";
  const taskIdentifier =
    taskObj && "identifier" in taskObj && typeof taskObj.identifier === "string"
      ? taskObj.identifier
      : "";
  await expect(dialog).toBeHidden({ timeout: 15_000 });
  return { taskId, taskIdentifier };
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
    !B4_ON_ROOT,
    "Missing backend routes POST /drive-connections/{id}/picker-token, POST /workspaces/{ws}/drive-files, CreateTaskSDI.drive_files, and GET /tasks/{taskID}/drive-files (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await signInAndOpenSettingsIntegrations(page, "drive-q1-task-link");
  const { googleEmail } = await connectDriveForCurrentUser(page);

  const seedFile: FakeDriveSeedFile = {
    id: "fake_gdoc_q1_task",
    name: fakeDriveName("fake_gdoc_q1_task"),
    mimeType: "application/vnd.google-apps.document",
    sharingState: "shared",
  };
  const { taskId } = await createTaskWithFakeDriveFile(
    page,
    account.orgSlug,
    account.wsSlug,
    "Chuẩn bị kế hoạch Q4",
    seedFile,
  );

  await page.goto(`/${account.orgSlug}/${account.wsSlug}/tasks/${taskId}`);
  const attachmentsSection = page.getByRole("region", { name: "Đính kèm" });
  await expect(attachmentsSection).toBeVisible({ timeout: 30_000 });

  const card = attachmentsSection.locator('[data-testid^="task-drive-card-"]').first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(fakeDriveName(seedFile.id))).toBeVisible();
  await expect(card.getByText(`Drive: ${googleEmail}`)).toBeVisible();
  await expect(card.getByRole("link", { name: "Mở trên Google Drive" })).toBeVisible();
});

test("3. Documents › Google Drive (4.1) for A lists that file (all accounts + the account view); the sidebar Google Drive section shows", async ({
  page,
}) => {
  test.fixme(
    !B4_ON_ROOT,
    "Missing backend route GET /api/v1/workspaces/{workspaceID}/drive-files and POST /drive-files to link a file (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await signInAndOpenSettingsIntegrations(page, "drive-q1-list-41");
  const { googleEmail } = await connectDriveForCurrentUser(page);

  const seedFile: FakeDriveSeedFile = {
    id: "fake_gdoc_q1_41",
    name: fakeDriveName("fake_gdoc_q1_41"),
    mimeType: "application/vnd.google-apps.document",
    sharingState: "shared",
  };
  const { taskIdentifier } = await createTaskWithFakeDriveFile(
    page,
    account.orgSlug,
    account.wsSlug,
    "Đọc tài liệu chiến lược",
    seedFile,
  );

  await page.goto(`/${account.orgSlug}/${account.wsSlug}/documents?view=drive`);
  await expect(page.getByRole("heading", { level: 1, name: "Google Drive" })).toBeVisible({
    timeout: 30_000,
  });

  const docsSidebar = page.getByRole("navigation", { name: "Điều hướng tài liệu" });
  const sidebarAllBtn = docsSidebar.getByRole("button", { name: /^Google Drive/ });
  const sidebarAccountBtn = docsSidebar.getByRole("button", {
    name: new RegExp(`Drive: ${googleEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  });
  await expect(sidebarAllBtn).toBeVisible();
  await expect(sidebarAllBtn).toHaveAttribute("aria-current", "page");
  await expect(sidebarAccountBtn).toBeVisible();

  const table = page.getByRole("table");
  await expect(table.getByRole("link", { name: fakeDriveName(seedFile.id) })).toBeVisible({ timeout: 20_000 });
  await expect(table.getByText(googleEmail)).toBeVisible();
  await expect(table.getByText(taskIdentifier)).toBeVisible();

  await sidebarAccountBtn.click();
  await expect(page).toHaveURL(/view=drive&account=/, { timeout: 15_000 });
  await expect(sidebarAccountBtn).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("heading", { level: 1, name: `Drive: ${googleEmail}` }),
  ).toBeVisible();
  await expect(table.getByRole("link", { name: fakeDriveName(seedFile.id) })).toBeVisible();
});

test("4. User B (same workspace, no connection): sees the file on the task card as unknown/no access per §7.10, and B's 4.1 shows none of A's files (empty state)", async ({
  page,
  browser,
}) => {
  test.fixme(
    !B4_ON_ROOT,
    "Missing backend routes GET /api/v1/tasks/{taskID}/drive-files and GET /api/v1/workspaces/{workspaceID}/drive-files (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const accountA = await signInAndOpenSettingsIntegrations(page, "drive-q1-user-a");
  await connectDriveForCurrentUser(page);

  const seedFile: FakeDriveSeedFile = {
    id: "fake_gdoc_q1_visibility",
    name: fakeDriveName("fake_gdoc_q1_visibility"),
    mimeType: "application/vnd.google-apps.document",
    sharingState: "shared",
  };
  const { taskId } = await createTaskWithFakeDriveFile(
    page,
    accountA.orgSlug,
    accountA.wsSlug,
    "Review đặc tả kỹ thuật",
    seedFile,
  );

  // Register User B in a separate browser context and invite B into A's workspace without connecting Drive.
  const contextB = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    locale: "vi-VN",
    storageState: VI_LOCALE_STATE,
  });
  try {
    const pageB = await contextB.newPage();
    const userB = await registerApiUser(pageB, e2eApiUrl, "drive-q1-user-b");
    await joinWorkspaceAsMember(pageB, e2eApiUrl, accountA.token, accountA.wsId, userB);
    const onboardedB = await pageB.request.post(`${e2eApiUrl}/api/v1/me/onboarding/complete`, {
      headers: { authorization: `Bearer ${userB.token}`, "content-type": "application/json" },
      data: { completion_path: "full", workspace_id: accountA.wsId },
    });
    expect(
      onboardedB.ok(),
      `user B onboarding: HTTP ${onboardedB.status()} ${await onboardedB.text()}`,
    ).toBeTruthy();
    await loginViaUi(pageB, userB.email);

    // B opens the task and sees the Drive card in the viewer_access === "unknown" state (§7.10).
    await pageB.goto(`/${accountA.orgSlug}/${accountA.wsSlug}/tasks/${taskId}`);
    const attachmentsB = pageB.getByRole("region", { name: "Đính kèm" });
    await expect(attachmentsB).toBeVisible({ timeout: 30_000 });
    await expect(attachmentsB.getByText(fakeDriveName(seedFile.id))).toBeVisible({ timeout: 20_000 });

    const unknownBlock = attachmentsB.locator('[data-testid^="task-drive-card-unknown-"]').first();
    await expect(unknownBlock).toBeVisible();
    await expect(unknownBlock.getByText("Bạn chưa cho UniWork đọc tệp này.")).toBeVisible();
    await expect(
      unknownBlock.getByRole("button", { name: "Cho UniWork đọc tệp" }),
    ).toBeVisible();
    await expect(unknownBlock.getByRole("link", { name: "Mở trên Google Drive" })).toBeVisible();

    // B's 4.1 Documents › Google Drive shows none of A's files (empty state), and the sidebar Drive section is hidden for B.
    await pageB.goto(`/${accountA.orgSlug}/${accountA.wsSlug}/documents?view=drive`);
    await expect(pageB.getByRole("heading", { level: 1, name: "Google Drive" })).toBeVisible({
      timeout: 30_000,
    });
    await expect(
      pageB.getByText("Chưa có tệp Google Drive nào được liên kết."),
    ).toBeVisible({ timeout: 20_000 });
    await expect(pageB.getByText(fakeDriveName(seedFile.id))).toHaveCount(0);
    const sidebarB = pageB.getByRole("navigation", { name: "Điều hướng tài liệu" });
    await expect(sidebarB.getByRole("button", { name: /^Google Drive/ })).toHaveCount(0);
  } finally {
    await contextB.close();
  }
});

test("5. A unlinks at the 4.2 file page; the card on the already-open task page refreshes without reload (realtime/query invalidation), file gone from 4.1", async ({
  page,
  context,
}) => {
  test.fixme(
    !B4_ON_ROOT,
    "Missing backend routes GET/DELETE /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID} and drive_file.unlinked outbox emission (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await signInAndOpenSettingsIntegrations(page, "drive-q1-unlink-42");
  await connectDriveForCurrentUser(page);

  const seedFile: FakeDriveSeedFile = {
    id: "fake_gdoc_q1_unlink",
    name: fakeDriveName("fake_gdoc_q1_unlink"),
    mimeType: "application/vnd.google-apps.document",
    sharingState: "shared",
  };
  const { taskId, taskIdentifier } = await createTaskWithFakeDriveFile(
    page,
    account.orgSlug,
    account.wsSlug,
    "Tổng hợp báo cáo tiến độ",
    seedFile,
  );

  // Keep the task page open in `page` and assert the Drive card is visible.
  await page.goto(`/${account.orgSlug}/${account.wsSlug}/tasks/${taskId}`);
  const attachmentsSection = page.getByRole("region", { name: "Đính kèm" });
  await expect(attachmentsSection).toBeVisible({ timeout: 30_000 });
  const card = attachmentsSection.locator('[data-testid^="task-drive-card-"]').first();
  await expect(card).toBeVisible({ timeout: 20_000 });
  await expect(card.getByText(fakeDriveName(seedFile.id))).toBeVisible();
  const cardTestId = await card.getAttribute("data-testid");
  const driveFileId = (cardTestId ?? "").replace(/^task-drive-card-/, "");
  expect(driveFileId).toBeTruthy();

  // Open 4.2 Drive file detail page in a second tab of the same context.
  const detailPage = await context.newPage();
  await detailPage.setViewportSize({ width: 1440, height: 900 });
  await detailPage.goto(
    `/${account.orgSlug}/${account.wsSlug}/documents/drive/${encodeURIComponent(driveFileId)}`,
  );
  await expect(
    detailPage.getByRole("heading", { level: 1, name: fakeDriveName(seedFile.id) }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(detailPage.getByRole("heading", { name: "Đang dùng ở · 1" })).toBeVisible();
  await expect(detailPage.getByRole("link", { name: new RegExp(taskIdentifier) })).toBeVisible();

  // Unlink the file from the workspace on 4.2.
  await detailPage.getByRole("button", { name: "Bỏ liên kết" }).click();
  const confirmDialog = detailPage.getByRole("alertdialog");
  await expect(confirmDialog).toBeVisible({ timeout: 10_000 });
  await expect(
    confirmDialog.getByRole("heading", { name: "Bỏ liên kết khỏi 1 việc?" }),
  ).toBeVisible();
  await confirmDialog.getByRole("button", { name: "Bỏ liên kết" }).click();

  // 4.2 navigates back to 4.1 (`?view=drive`), where the file is gone (empty state).
  await expect(detailPage).toHaveURL(/\/documents\?view=drive/, { timeout: 20_000 });
  await expect(
    detailPage.getByText("Chưa có tệp Google Drive nào được liên kết."),
  ).toBeVisible({ timeout: 20_000 });
  await expect(detailPage.getByText(fakeDriveName(seedFile.id))).toHaveCount(0);

  // On the already-open task page (`page`), the card disappears without a reload via `drive_file.unlinked` realtime invalidation.
  await expect(attachmentsSection.getByText(fakeDriveName(seedFile.id))).toHaveCount(0, { timeout: 20_000 });
  await expect(attachmentsSection.getByTestId("task-attachments-empty")).toBeVisible({
    timeout: 20_000,
  });
  await detailPage.close();
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
    !B4_ON_ROOT,
    "Missing backend routes GET /api/v1/workspaces/{workspaceID}/drive-files and GET /api/v1/workspaces/{workspaceID}/drive-files/{driveFileID} needed for 4.1 and 4.2 to render beyond their error state (card B4 / UNI-2180 not merged on root 1c9bbb275)",
  );
  test.slow();
  await page.setViewportSize({ width: 1440, height: 900 });
  const account = await signInAndOpenSettingsIntegrations(page, "drive-q1-a11y-41-42");
  await connectDriveForCurrentUser(page);

  const seedFile: FakeDriveSeedFile = {
    id: "fake_gdoc_q1_a11y",
    name: fakeDriveName("fake_gdoc_q1_a11y"),
    mimeType: "application/vnd.google-apps.document",
    sharingState: "shared",
  };
  await createTaskWithFakeDriveFile(
    page,
    account.orgSlug,
    account.wsSlug,
    "Kiểm thử 4.1 và 4.2",
    seedFile,
  );

  // 4.1 Documents › Google Drive list page contrast + focus (light + dark)
  await page.goto(`/${account.orgSlug}/${account.wsSlug}/documents?view=drive`);
  await expect(page.getByRole("heading", { level: 1, name: "Google Drive" })).toBeVisible({
    timeout: 30_000,
  });
  const fileLink = page.getByRole("table").getByRole("link", { name: fakeDriveName(seedFile.id) });
  await expect(fileLink).toBeVisible({ timeout: 20_000 });

  for (const mode of ["light", "dark"] as const) {
    await setMode(page, mode);
    const contrast41 = await auditText(page, "main");
    expect(contrast41.colorLevel4, "browser canvas must support CSS Color 4").toBe(true);
    expect(contrast41.checked, `4.1 list checked nodes (${mode})`).toBeGreaterThan(8);
    expect(
      contrast41.fails,
      `4.1 list contrast (${mode}): ${contrast41.fails.join(" | ")}`,
    ).toEqual([]);

    const addBtn = page.getByRole("button", { name: "Thêm từ Google Drive" });
    await addBtn.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const focusInfo41 = await checkActiveFocusIndicator(page);
    expect(focusInfo41?.ok, `4.1 add button focus indicator (${mode})`).toBe(true);
    const ringBad41 = await checkActiveFocusRingContrast(page);
    expect(ringBad41, `4.1 add button focus ring contrast (${mode})`).toBeNull();
  }

  // Navigate to 4.2 Drive file detail page and check contrast + focus (light + dark)
  await fileLink.click();
  await expect(page).toHaveURL(/\/documents\/drive\/[0-9A-HJKMNP-TV-Z]{26}$/, {
    timeout: 20_000,
  });
  await expect(page.getByRole("heading", { level: 1, name: fakeDriveName(seedFile.id) })).toBeVisible({
    timeout: 30_000,
  });

  for (const mode of ["light", "dark"] as const) {
    await setMode(page, mode);
    const contrast42 = await auditText(page, "main");
    expect(contrast42.checked, `4.2 detail checked nodes (${mode})`).toBeGreaterThan(10);
    expect(
      contrast42.fails,
      `4.2 detail contrast (${mode}): ${contrast42.fails.join(" | ")}`,
    ).toEqual([]);

    const unlinkBtn = page.getByRole("button", { name: "Bỏ liên kết" });
    await unlinkBtn.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    const focusInfo42 = await checkActiveFocusIndicator(page);
    expect(focusInfo42?.ok, `4.2 unlink button focus indicator (${mode})`).toBe(true);
    const ringBad42 = await checkActiveFocusRingContrast(page);
    expect(ringBad42, `4.2 unlink button focus ring contrast (${mode})`).toBeNull();
  }
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

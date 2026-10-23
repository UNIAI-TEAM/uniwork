import { expect, test, type Locator, type Page } from "@playwright/test";
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };
import { gotoLanding, landingReady } from "./landing-ready";

async function meetingReady(page: Page) {
  await landingReady(page);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.product-demo-shell')).toHaveAttribute("data-demo-feature", "meetings");
}

async function controlsFit(page: Page, scope: Locator) {
  const controls = await scope.locator('[data-demo-meeting-controls]').boundingBox();
  const viewport = await page.locator('.product-demo-content').boundingBox();
  expect(controls).not.toBeNull();
  expect(controls!.y).toBeGreaterThanOrEqual(viewport!.y);
  expect(controls!.y + controls!.height).toBeLessThanOrEqual(viewport!.y + viewport!.height + 1);
  expect(controls!.x).toBeGreaterThanOrEqual(viewport!.x);
  expect(controls!.x + controls!.width).toBeLessThanOrEqual(viewport!.x + viewport!.width + 1);
  expect(await page.locator('.product-demo-content').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
}

for (const sample of [{ width: 1680, locale: "en" }, { width: 1440, locale: "vi", dark: true }, { width: 768, locale: "vi" }, { width: 390, locale: "vi" }] as const) {
  test(`the current conference and bottom controls fit at ${sample.width}px`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "dark" in sample ? "dark" : "light" });
    await gotoLanding(page, "/#hop");
    await meetingReady(page);
    const player = page.locator('.product-current-meeting-player');
    await expect(player.locator('.lovable-viewport')).toHaveCount(0);
    await expect(player.locator('.product-meeting-tile')).toHaveCount(4);
    await controlsFit(page, player);
    await expect(page.locator('#product-preview')).not.toContainText(/(?:meetings|common|landing)\.[a-z][\w.]+/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await page.locator('#product-preview').screenshot({ path: `.impeccable/review/current-meeting-${sample.width}.png`, animations: "disabled" });
  });
}

test("the source-backed manual room supports devices, sharing, recording, chat and AI actions", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const roomRequests: string[] = [];
  page.on("request", request => { if (/\/api\/v1\/meetings/.test(request.url())) roomRequests.push(request.url()); });
  await gotoLanding(page, "/#hop");
  await meetingReady(page);
  await page.locator('[data-action="toggle-presentation"]').click();
  const manual = page.locator('.manual-preview:not([hidden])');
  const controls = manual.locator('[data-demo-meeting-controls]');
  await controls.getByRole('button', { name: vi.meetings.mic, exact: true }).click();
  await expect(controls.getByRole('button', { name: vi.meetings.mic, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await controls.getByRole('button', { name: vi.meetings.camera, exact: true }).click();
  await expect(manual.locator('.product-meeting-tile[data-self=true]')).toHaveAttribute('data-camera', 'true');
  await controls.getByRole('button', { name: vi.meetings.share, exact: true }).click();
  const picker = page.getByRole('dialog');
  await picker.locator('[data-demo-target="share-source"]').click();
  await picker.locator('[data-demo-target="share-confirm"]').click();
  await expect(manual.locator('[data-demo-result="screen"]')).toBeVisible();
  await controlsFit(page, manual);
  await controls.getByRole('button', { name: vi.meetings.devices, exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel(vi.meetings.deviceMic, { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await controls.getByRole('button', { name: vi.meetings.record, exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: vi.meetings.confirmStartRecording, exact: true }).click();
  await expect(manual.locator('.product-meeting-recording')).toBeVisible();
  await controls.getByRole('button', { name: vi.meetings.stopRecording, exact: true }).click();
  const panel = manual.locator('.product-meeting-panel');
  await panel.getByRole('tab', { name: vi.meetings.chat, exact: true }).click();
  await panel.getByRole('textbox', { name: vi.meetings.chatPlaceholder }).fill('Gửi ghi chú trong phòng họp demo');
  await panel.getByRole('button', { name: vi.landing.demo.send, exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('Gửi ghi chú trong phòng họp demo');
  await panel.getByRole('tab', { name: vi.meetings.chat, exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(panel.getByRole('tab', { name: vi.meetings.people, exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('.product-demo-shell')).toHaveAttribute('data-demo-feature', 'meetings');
  await panel.getByRole('tab', { name: vi.meetings.chat, exact: true }).click();
  const panelToggle = manual.locator('.product-meeting-header').getByRole('button', { name: vi.meetings.roomPanel, exact: true });
  await panelToggle.click();
  await panelToggle.click();
  await expect(panel.getByRole('log')).toContainText('Gửi ghi chú trong phòng họp demo');
  await panel.getByRole('tab', { name: vi.meetings.aiCopilot, exact: true }).click();
  await expect(panel.getByTestId('meeting-copilot-ask-locked')).toContainText(vi.meetings.comingSoon);
  await panel.getByRole('button', { name: vi.meetings.generateSummary, exact: true }).click();
  await panel.getByRole('tab', { name: vi.meetings.notes, exact: true }).click();
  await panel.getByRole('textbox', { name: vi.meetings.notesInputLabel }).fill('Chốt lịch triển khai vào thứ Sáu');
  await panel.getByRole('button', { name: vi.meetings.addNote, exact: true }).click();
  await expect(panel).toContainText('Chốt lịch triển khai vào thứ Sáu');
  await panel.getByRole('tab', { name: vi.meetings.actionsTab, exact: true }).click();
  await panel.locator('.product-meeting-copilot-body button').click();
  await expect(page.locator('.product-demo-shell')).toHaveAttribute('data-demo-feature', 'tasks');
  await expect(page.getByRole('tabpanel').locator('.product-task-open')).toHaveCount(9);
  expect(roomRequests).toEqual([]);
});

test("a phone keeps five meeting controls visible and opens the real panel tabs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/#hop');
  await meetingReady(page);
  await page.locator('[data-action="toggle-presentation"]').click();
  const manual = page.locator('.manual-preview:not([hidden])');
  const controls = manual.locator('[data-demo-meeting-controls]');
  await expect(controls.getByRole('button')).toHaveCount(5);
  await controlsFit(page, manual);
  await controls.getByRole('button', { name: vi.meetings.aiCopilot, exact: true }).click();
  const panel = page.getByRole('dialog');
  await expect(panel.getByRole('tab', { name: vi.meetings.recordingsTab, exact: true })).toBeAttached();
  await panel.getByRole('tab', { name: vi.meetings.chat, exact: true }).click();
  await expect(panel.getByRole('textbox', { name: vi.meetings.chatPlaceholder })).toBeVisible();
  await panel.getByRole('textbox', { name: vi.meetings.chatPlaceholder }).fill('Ghi chú từ điện thoại');
  await panel.getByRole('button', { name: vi.landing.demo.send, exact: true }).click();
  await page.keyboard.press('Escape');
  await controls.getByRole('button', { name: vi.meetings.aiCopilot, exact: true }).click();
  await panel.getByRole('tab', { name: vi.meetings.chat, exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('Ghi chú từ điện thoại');
  await page.keyboard.press('Escape');
  await controls.getByRole('button', { name: vi.meetings.more, exact: true }).click();
  await page.getByRole('button', { name: vi.meetings.share, exact: true }).click();
  await page.getByRole('dialog').locator('[data-demo-target="share-source"]').click();
  await page.getByRole('dialog').locator('[data-demo-target="share-confirm"]').click();
  await expect(manual.locator('[data-demo-result="screen"]')).toBeVisible();
  await controlsFit(page, manual);
});

test("the meeting movie targets the visible Share control and completes sharing", async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/#hop');
  await meetingReady(page);
  const player = page.locator('.product-current-meeting-player');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(player).toHaveAttribute('data-running', 'true');
  await expect(player.locator('.product-meeting-overlay')).toBeVisible({ timeout: 6000 });
  await expect(player.locator('[data-demo-target="share-source"]')).toHaveAttribute('data-selected', 'true', { timeout: 7000 });
  await expect(player.locator('[data-demo-result="screen"]')).toBeVisible({ timeout: 7000 });
  await player.locator('[data-action="toggle-playback"]').click();
  await controlsFit(page, player);
  await page.locator('#product-preview').screenshot({ path: '.impeccable/review/current-meeting-shared-1440.png', animations: 'disabled' });
  await player.getByRole('button', { name: vi.landing.lovable.meetingList, exact: true }).click();
  await expect(player).toHaveAttribute('data-running', 'false');
  await expect(player.locator('.product-meeting-list article')).toHaveCount(4);
});

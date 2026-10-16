import { expect, test, type Page } from "@playwright/test";
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };
import { gotoLanding, landingReady } from "./landing-ready";

async function emailReady(page: Page, manual = false) {
  await landingReady(page);
  await page.waitForLoadState("networkidle");
  await expect(page.locator('.product-demo-shell')).toHaveAttribute('data-demo-feature', 'email');
  if (manual) await page.locator('[data-action="toggle-presentation"]').click();
}

for (const sample of [{ width: 1680, locale: "en" }, { width: 1440, locale: "vi", dark: true }, { width: 768, locale: "vi" }, { width: 390, locale: "vi" }] as const) {
  test(`the current inbox fits at ${sample.width}px`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'uniwork-locale', value: sample.locale, url: baseURL! }]);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' in sample ? 'dark' : 'light' });
    await gotoLanding(page, '/#email');
    await emailReady(page);
    const player = page.locator('.product-current-email-player');
    await expect(player.locator('[data-thread-row]')).toHaveCount(13);
    await expect(player.locator('.product-email-reader')).toHaveCount(0);
    await expect(player.locator('.lovable-viewport')).toHaveCount(0);
    expect(await page.locator('.product-demo-content').evaluate(node => node.scrollHeight - node.clientHeight)).toBeLessThanOrEqual(1);
    expect(await player.locator('.product-email-workspace').evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
    await expect(page.locator('#product-preview')).not.toContainText(/(?:email_hub|landing|common)\.[a-z][\w.]+/);
    await page.locator('#product-preview').screenshot({ path: `.impeccable/review/current-email-${sample.width}.png`, animations: 'disabled' });
  });
}

test('mail can be searched, filtered, starred, archived and composed locally', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const mailRequests: string[] = [];
  page.on('request', request => { if (/\/api\/v1\/.*email/.test(request.url())) mailRequests.push(request.url()); });
  await gotoLanding(page, '/#email');
  await emailReady(page, true);
  const manual = page.locator('.manual-preview:not([hidden]) .product-email-workspace');
  const list = manual.locator('.product-email-list');
  const search = manual.getByRole('searchbox', { name: vi.email_hub.search_label });
  await search.fill('Minh Linh');
  await expect(list.locator('[data-thread-row]')).toHaveCount(2);
  await search.fill('');
  await manual.getByRole('button', { name: vi.email_hub.filters.attachments, exact: true }).click();
  await expect(list.locator('[data-thread-row]')).toHaveCount(2);
  await manual.getByRole('button', { name: vi.email_hub.filters.attachments, exact: true }).click();
  await list.locator('[data-thread-row="demo-mail-0"]').click();
  await expect(manual.locator('.product-email-reader')).toBeVisible();
  await manual.getByRole('button', { name: vi.email_hub.star_shortcut, exact: true }).click();
  await expect(manual.getByRole('button', { name: vi.email_hub.star_shortcut, exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await manual.getByRole('navigation', { name: vi.email_hub.folders_nav }).getByRole('button', { name: vi.email_hub.folders.starred, exact: true }).click();
  await expect(list.locator('[data-thread-row]')).toHaveCount(1);
  await list.locator('[data-thread-row]').click();
  await manual.getByRole('button', { name: vi.email_hub.archive_shortcut, exact: true }).click();
  await manual.getByRole('button', { name: vi.email_hub.folders.more, exact: true }).click();
  await manual.getByRole('button', { name: vi.email_hub.folders.archive, exact: true }).click();
  await expect(list.locator('[data-thread-row="demo-mail-0"]')).toBeVisible();
  await manual.getByRole('button', { name: new RegExp(`^${vi.email_hub.compose_label}`) }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel(vi.email_hub.compose.to, { exact: true }).fill('team@example.com');
  await dialog.getByLabel(vi.email_hub.compose.to, { exact: true }).press('Enter');
  await dialog.getByLabel(vi.email_hub.compose.subject, { exact: true }).fill('Kế hoạch trong demo');
  await dialog.getByLabel(vi.email_hub.compose.body, { exact: true }).fill('Cùng rà soát kế hoạch trước thứ Sáu.');
  await dialog.getByRole('button', { name: vi.common.close, exact: true }).click();
  await manual.getByRole('button', { name: vi.email_hub.folders.drafts, exact: true }).click();
  await list.getByRole('button', { name: /Kế hoạch trong demo/ }).click();
  dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel(vi.email_hub.compose.body, { exact: true })).toHaveValue('Cùng rà soát kế hoạch trước thứ Sáu.');
  await expect(dialog).not.toContainText(/(?:email_hub|common|workspace)\.[a-z][\w.]+/);
  await dialog.getByRole('button', { name: /^Gửi/ }).first().click();
  await expect(manual.getByRole('status')).toContainText(vi.landing.productDemo.email.sentLocally);
  await manual.getByRole('button', { name: vi.email_hub.folders.sent, exact: true }).click();
  await expect(list.getByRole('button', { name: /Kế hoạch trong demo/ })).toBeVisible();
  expect(mailRequests).toEqual([]);
});

test('phone folder navigation and reading actions remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/#email');
  await emailReady(page, true);
  const manual = page.locator('.manual-preview:not([hidden]) .product-email-workspace');
  await manual.locator('[data-thread-row="demo-mail-0"]').click();
  await manual.getByRole('button', { name: vi.email_hub.star_shortcut, exact: true }).click();
  await manual.getByRole('button', { name: vi.email_hub.back_to_list_shortcut, exact: true }).click();
  await manual.getByRole('button', { name: vi.email_hub.folder_menu.replace('{{folder}}', vi.email_hub.folders.inbox), exact: true }).click();
  await page.getByRole('menuitem', { name: vi.email_hub.folders.starred, exact: true }).click();
  await expect(manual.locator('[data-thread-row]')).toHaveCount(1);
  await manual.getByRole('button', { name: vi.email_hub.compose_label, exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText(vi.landing.productDemo.email.localOnly);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
});

test('autoplay opens a full-width reader, stars the message and can pause', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/#email');
  await emailReady(page);
  const player = page.locator('.product-current-email-player');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(player).toHaveAttribute('data-running', 'true');
  await expect(player.locator('.product-email-reader')).toBeVisible({ timeout: 6000 });
  await expect(player.locator('[data-demo-result="starred"]')).toBeVisible({ timeout: 6000 });
  await page.locator('#product-preview [data-action="toggle-playback"]').click();
  await expect(player).toHaveAttribute('data-running', 'false');
  await page.locator('#product-preview').screenshot({ path: '.impeccable/review/current-email-reader-1440.png', animations: 'disabled' });
});

test('the standalone email preview also has product copy and reachable playback controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/features/email#feature-preview');
  await landingReady(page);
  await page.waitForLoadState("networkidle");
  await page.bringToFront();
  const player = page.locator('.product-current-email-player');
  await player.scrollIntoViewIfNeeded();
  await expect(player).toBeInViewport({ ratio: .5 });
  await expect(player.locator('[data-thread-row]')).toHaveCount(13);
  await expect(player).not.toContainText(/(?:email_hub|landing)\.[a-z][\w.]+/);
  await page.locator('#product-preview [data-action="toggle-playback"]').click();
  await expect(player).toHaveAttribute('data-running', 'true');
});

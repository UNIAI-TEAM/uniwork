import { expect, test } from "@playwright/test";
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };
import { gotoLanding, landingReady } from "./landing-ready";
import { selectWorkspaceFeature } from "./landing-catalog-helpers";

for (const sample of [{ width: 1440, theme: "light" }, { width: 390, theme: "dark" }] as const) {
  test(`current product screens fit the preview at ${sample.width}px`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize({ width: sample.width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: sample.theme });
    await gotoLanding(page, '/#platform');
    await landingReady(page);
    await page.waitForLoadState('networkidle');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const panel = page.locator('.preview-main > [role=tabpanel]:not([hidden])');
    for (const feature of ['documents', 'chat', 'ask', 'projects', 'organization', 'calendar', 'today']) {
      await selectWorkspaceFeature(page, feature);
      await expect(panel).toBeVisible();
      await expect(panel.locator('.lovable-viewport')).toHaveCount(0);
      await expect(panel).not.toContainText(/(?:documents|chat|ai|calendar|people|myTasks|projects|editor|landing)\.[a-z][\w.]+/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth), feature).toBeLessThanOrEqual(1);
      expect(await page.locator('#product-preview .product-demo-content').evaluate(node => node.scrollHeight - node.clientHeight), `${feature} keeps its own scroll`).toBeLessThanOrEqual(1);
      if (feature === 'documents') await expect(panel.getByRole('list', { name: vi.documents.home.create.label }).getByRole('button')).toHaveCount(8);
      if (feature === 'calendar') await expect(panel.locator('.fc')).toBeVisible();
      await page.locator('#product-preview').screenshot({ path: `.impeccable/review/current-${feature}-${sample.width}.png`, animations: 'disabled' });
    }
    expect(errors).toEqual([]);
  });
}

test('documents use the current library and retain a locally edited page', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const writes: string[] = [];
  page.on('request', request => { if (request.method() !== 'GET' && /\/api\/v1\/.*(?:documents|tasks|projects)/.test(request.url())) writes.push(request.url()); });
  await gotoLanding(page, '/#tai-lieu');
  await landingReady(page);
  const panel = page.locator('.preview-main > [role=tabpanel]:not([hidden])');
  await expect(panel.locator('.product-documents-library')).toBeVisible();
  await panel.getByRole('list', { name: vi.documents.home.create.label }).getByRole('button').first().click();
  await expect(panel.locator('[contenteditable=true]')).toBeVisible();
  await panel.locator('[contenteditable=true]').fill('Nội dung trang mẫu được lưu trong demo.');
  await panel.getByRole('button', { name: vi.common.save, exact: true }).click();
  await expect(panel.getByRole('status').filter({ hasText: vi.landing.productDemo.saved })).toBeVisible();
  await selectWorkspaceFeature(page, 'tasks');
  await selectWorkspaceFeature(page, 'documents');
  await expect(panel.locator('[contenteditable=true]')).toContainText('Nội dung trang mẫu được lưu trong demo.');
  await panel.getByRole('button', { name: vi.common.back, exact: true }).click();
  await panel.getByRole('searchbox', { name: vi.documents.home.search.label }).fill('Project budget');
  await expect(panel.getByRole('row').filter({ hasText: 'Project budget.xlsx' })).toBeVisible();
  await expect(panel.getByRole('row').filter({ hasText: 'Launch presentation.pptx' })).toHaveCount(0);
  expect(writes).toEqual([]);
});

test('the current chat composer sends locally and creates a task from a message', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/#trao-doi');
  await landingReady(page);
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#product-preview .product-demo-shell')).toHaveAttribute('data-demo-feature', 'chat');
  await page.locator('[data-action=toggle-presentation]').click();
  const panel = page.locator('.preview-main > [role=tabpanel]:not([hidden])');
  await panel.getByRole('textbox', { name: vi.landing.demo.messagePlaceholder }).fill('Tin nhắn được gửi trong demo mới.');
  await panel.getByRole('button', { name: vi.landing.demo.send, exact: true }).click();
  await expect(panel.getByRole('log')).toContainText('Tin nhắn được gửi trong demo mới.');
  const message = panel.locator('.product-chat-messages article').first();
  await message.hover();
  await message.getByRole('button', { name: vi.chat.action_more, exact: true }).click();
  await page.getByRole('menuitem', { name: vi.chat.link.create_task, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: vi.common.create, exact: true }).click();
  await expect(panel.locator('[data-demo-result=chat-task]')).toBeVisible();
  await panel.locator('[data-demo-result=chat-task]').click();
  await expect(page.locator('#product-preview .product-demo-shell')).toHaveAttribute('data-demo-feature', 'tasks');
  // The ten demo tasks (product-task-data.ts) plus the one created from the message.
  await expect(panel.locator('.product-task-open')).toHaveCount(11);
  await expect(panel.locator('.product-task-details')).toContainText(vi.landing.studio.task_followup);
});

test('projects and people use the shared list controls', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/#platform');
  await landingReady(page);
  await selectWorkspaceFeature(page, 'projects');
  const panel = page.locator('.preview-main > [role=tabpanel]:not([hidden])');
  await panel.getByRole('textbox', { name: vi.projects.page.search_placeholder }).fill('Website');
  await expect(panel.getByText(vi.landing.productDemo.projects.website, { exact: true })).toBeVisible();
  await expect(panel.getByText(vi.landing.productDemo.projects.campaign, { exact: true })).toHaveCount(0);
  await panel.getByRole('button', { name: vi.projects.page.view_cards, exact: true }).click();
  await page.getByRole('menuitemradio', { name: vi.projects.page.view_cards, exact: true }).click();
  await expect(panel.locator('[data-slot=project-card-footer]')).toHaveCount(1);
  await selectWorkspaceFeature(page, 'organization');
  await panel.getByRole('searchbox', { name: vi.people.search, exact: true }).fill('Khánh Vy');
  await expect(panel.getByRole('link', { name: 'Khánh Vy', exact: true })).toBeVisible();
  await expect(panel.getByRole('link', { name: 'Bảo Lâm', exact: true })).toHaveCount(0);
  await panel.getByRole('link', { name: 'Khánh Vy', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Khánh Vy');
  await page.getByRole('dialog').getByRole('button', { name: vi.nav.chat, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#product-preview .product-demo-shell')).toHaveAttribute('data-demo-feature', 'chat');
});

test('feature pages share the current Documents preview', async ({ page }) => {
  await page.setViewportSize({ width: 1680, height: 1000 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/features/documents#feature-preview');
  await landingReady(page);
  await expect(page.locator('#product-preview .product-demo-shell')).toHaveAttribute('data-demo-feature', 'documents');
  const panel = page.locator('.preview-main > [role=tabpanel]:not([hidden])');
  await expect(panel.getByRole('list', { name: vi.documents.home.create.label }).getByRole('button')).toHaveCount(8);
  await expect(panel).not.toContainText(/documents\.[a-z][\w.]+/);
  await page.locator('.feature-page-related a').first().click();
  await expect(page.locator('#product-preview .product-demo-shell')).not.toHaveAttribute('data-demo-feature', 'documents');
});

test('a compact calendar keeps its grid and planner reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await gotoLanding(page, '/#platform');
  await landingReady(page);
  await selectWorkspaceFeature(page, 'calendar');
  const panel = page.locator('.preview-main > [role=tabpanel]:not([hidden])');
  await expect(panel.locator('.fc')).toBeVisible();
  expect((await panel.locator('.product-current-calendar-grid').boundingBox())!.width).toBeGreaterThan(300);
  const planner = panel.getByRole('button', { name: vi.calendar.planner_title, exact: true });
  await planner.click();
  await expect(panel.locator('.product-current-calendar-planner')).toBeVisible();
  await planner.click();
  await expect(panel.locator('.product-current-calendar-planner')).not.toBeVisible();
  await panel.locator('.product-current-calendar-grid .fc-event').first().click();
  await page.getByRole('dialog').getByRole('button', { name: vi.tasks.title, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#product-preview .product-demo-shell')).toHaveAttribute('data-demo-feature', 'tasks');
  await expect(page.locator('.preview-main > [role=tabpanel]:not([hidden]) .product-task-details')).toBeVisible();
});

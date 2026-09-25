import { type Browser, expect, type Locator, type Page, test } from "@playwright/test";
import { VI_LOCALE_STATE } from "./locale-state";
import { registerVerified } from "./auth-nav";
import {
  captureAuth,
  createProject,
  createSelectProperty,
  type SeededTask,
  seedTasks,
} from "./tasks-seed";

/**
 * Tasks table view against a real API: 120 root tasks (three with a child,
 * two projects, one select property). One user and one browser context for
 * the whole file — each scenario builds on the view state the previous one
 * left behind, the same way a person would use the table.
 */
const ROOTS = 120;
const PAGE_SIZE = 50;
const PROPERTY = "Giai đoạn";
/** The greatest seeded title: first under a descending title sort. */
const LAST_TITLE = `Việc ${String(ROOTS - 1).padStart(3, "0")}`;
const NAV_TIMEOUT = 15_000;
const TITLE_SELECTOR = "tbody tr td span.truncate.text-body";
const GROUP_SELECTOR = "tbody tr td > button.sticky";

let page: Page;
let tasksUrl: string;
let seeded: SeededTask[];

test.describe.configure({ mode: "serial" });

async function openSharedPage(browser: Browser, baseURL: string | undefined) {
  const context = await browser.newContext({ baseURL, locale: "vi-VN", storageState: VI_LOCALE_STATE });
  return context.newPage();
}

async function onboard(p: Page) {
  const { stamp } = await registerVerified(p, "Table E2E");
  await p.getByRole("button", { name: /Bắt đầu/ }).click();
  await p.getByRole("button", { name: "Bỏ qua" }).click();
  await p.getByLabel("Tên tổ chức").fill(`Org Bảng ${stamp}`);
  await p.getByRole("button", { name: /^Tạo / }).click();
  await p.getByLabel("Tên workspace").fill(`Đội Bảng ${stamp}`);
  await p.getByRole("button", { name: /^Tạo / }).click();
  await p.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(p).toHaveURL(/\/tasks$/, { timeout: NAV_TIMEOUT });
  const later = p.getByRole("button", { name: "Để sau" });
  await later.click({ timeout: NAV_TIMEOUT }).catch(() => undefined);
}

function tableView(): Locator {
  return page.getByTestId("task-table-view");
}

function scroller(): Locator {
  return tableView().locator("div.overflow-auto").first();
}

function titleCells(): Locator {
  return tableView().locator(TITLE_SELECTOR);
}

function rowByTitle(title: string): Locator {
  return tableView()
    .locator("tbody tr")
    .filter({ has: page.getByText(title, { exact: true }) });
}

async function switchMode(mode: "table" | "board") {
  await page.getByTestId("task-mode-switcher").click();
  await page.getByTestId(`task-mode-${mode}`).click();
}

/** The main thread answers within 500 ms, three times over three seconds. */
async function expectResponsive() {
  for (let i = 0; i < 3; i += 1) {
    const started = Date.now();
    await page.evaluate(() => 1);
    expect(Date.now() - started).toBeLessThan(500);
    if (i < 2) await page.waitForTimeout(1_000);
  }
}

async function scrollTableTo(position: "top" | "bottom") {
  await scroller().evaluate(
    (el, pos) =>
      new Promise<void>((resolve) => {
        el.scrollTop = pos === "top" ? 0 : el.scrollHeight;
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
    position,
  );
}

/**
 * Pages every root in with "Tải thêm", following the virtualized list down.
 * Returns the root total, which includes the task onboarding creates.
 */
async function loadAllRoots(): Promise<number> {
  const firstStatus = tableView().getByText(new RegExp(`^Hiển thị ${PAGE_SIZE}/\\d+$`));
  await expect(async () => {
    await scrollTableTo("bottom");
    await expect(firstStatus).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: NAV_TIMEOUT });
  const total = Number((await firstStatus.innerText()).split("/")[1]);
  expect(total).toBeGreaterThanOrEqual(ROOTS);
  for (let loaded = PAGE_SIZE; loaded < total; loaded += PAGE_SIZE) {
    const status = tableView().getByText(`Hiển thị ${loaded}/${total}`, { exact: true });
    await expect(async () => {
      await scrollTableTo("bottom");
      await expect(status).toBeVisible({ timeout: 1_000 });
    }).toPass({ timeout: NAV_TIMEOUT });
    await tableView().getByRole("button", { name: "Tải thêm", exact: true }).click();
    await expect(status).toBeHidden({ timeout: NAV_TIMEOUT });
  }
  await expect(async () => {
    await scrollTableTo("bottom");
    await expect(tableView().getByText(/^Hiển thị \d+\/\d+$/)).toHaveCount(0, { timeout: 1_000 });
  }).toPass({ timeout: NAV_TIMEOUT });
  return total;
}

/** Every rendered match's text from top to bottom, scrolling the virtualized body. */
async function collectTexts(selector: string): Promise<string[]> {
  await scrollTableTo("top");
  return scroller().evaluate(async (el, sel) => {
    const frame = () =>
      new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const seen: string[] = [];
    for (;;) {
      await frame();
      for (const node of Array.from(el.querySelectorAll(sel))) {
        const text = node.textContent ?? "";
        if (!seen.includes(text)) seen.push(text);
      }
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) return seen;
      el.scrollTop += Math.max(40, Math.floor(el.clientHeight * 0.6));
    }
  }, selector);
}

async function sortByTitle(direction: "Sắp xếp tăng dần" | "Sắp xếp giảm dần") {
  await tableView().locator("thead").getByRole("button", { name: "Tiêu đề", exact: true }).click();
  await page.getByRole("menuitem", { name: direction }).click();
  // The body keeps its scroll offset across a sort; read the new order from the top.
  await scrollTableTo("top");
}

function toolbar(): Locator {
  return tableView().locator(":scope > div").first();
}

async function groupBy(current: string, next: string) {
  await toolbar().getByRole("button", { name: current, exact: true }).click();
  await page.getByRole("menuitemradio", { name: next, exact: true }).click();
  await expect(toolbar().getByRole("button", { name: next, exact: true })).toBeVisible();
}

function groupButtons(): Locator {
  return tableView().locator(GROUP_SELECTOR);
}

async function headerTexts(): Promise<string[]> {
  const texts = await tableView().locator("thead th").allInnerTexts();
  return texts.map((text) => text.trim()).filter(Boolean);
}

test.beforeAll(async ({ browser }, testInfo) => {
  test.setTimeout(240_000);
  page = await openSharedPage(browser, testInfo.project.use.baseURL);
  await onboard(page);
  tasksUrl = page.url();

  const auth = await captureAuth(page);
  const alpha = await createProject(page, auth, "Alpha");
  const beta = await createProject(page, auth, "Beta");
  await createSelectProperty(page, auth, PROPERTY, ["Chuẩn bị", "Đang làm", "Xong"]);
  seeded = await seedTasks(page, auth, ROOTS, { withChildrenEvery: 40, projectIds: [alpha, beta] });
  expect(seeded.filter((task) => !task.parentId)).toHaveLength(ROOTS);
});

test.afterAll(async () => {
  await page?.context().close();
});

test("board → table stays responsive and navigation still works", async () => {
  await page.goto(tasksUrl);
  await switchMode("board");
  await expect(tableView()).toHaveCount(0, { timeout: NAV_TIMEOUT });

  await switchMode("table");
  await expect(tableView()).toBeVisible({ timeout: NAV_TIMEOUT });
  await expectResponsive();
  await expect(titleCells().first()).toBeVisible({ timeout: NAV_TIMEOUT });

  await page.getByRole("link", { name: "Dự án", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: NAV_TIMEOUT });

  await page.goto(tasksUrl);
  await expect(tableView()).toBeVisible({ timeout: NAV_TIMEOUT });
});

test("title sort holds across Tải thêm pages", async () => {
  await sortByTitle("Sắp xếp tăng dần");
  // `Việc 000` is the oldest task: only an applied title sort puts it on page one.
  await expect(rowByTitle("Việc 000")).toBeVisible({ timeout: NAV_TIMEOUT });
  const total = await loadAllRoots();

  const titles = await collectTexts(TITLE_SELECTOR);
  expect(titles).toHaveLength(total);
  expect(titles).toEqual([...titles].sort((a, b) => a.localeCompare(b, "vi")));
  await expectResponsive();
});

test("search finds a task outside the first page", async () => {
  const target = seeded.find((task) => task.number === 110);
  expect(target, "task #110 was seeded").toBeTruthy();
  const title = target!.title;
  // Descending titles fill page one with `Việc 119`…`Việc 070`; #110 is not among them.
  expect(Number(title.slice(-3))).toBeLessThan(ROOTS - PAGE_SIZE);
  await sortByTitle("Sắp xếp giảm dần");
  await expect(rowByTitle(LAST_TITLE)).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(rowByTitle(title)).toHaveCount(0);

  const search = tableView().getByPlaceholder(/Tìm công việc/);
  await search.fill(title);
  await expect(rowByTitle(title)).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(titleCells()).toHaveCount(1);

  await search.fill("");
  await expect(titleCells().nth(1)).toBeVisible({ timeout: NAV_TIMEOUT });
  await expectResponsive();
});

test("a child on the third page nests under its parent", async () => {
  const parent = seeded[0];
  const child = seeded.find((task) => task.parentId === parent.id)!;
  // Still descending titles from the search scenario: `Việc 000` is on the third page.
  await expect(rowByTitle(LAST_TITLE)).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect(rowByTitle(parent.title)).toHaveCount(0);
  await loadAllRoots();

  const parentRow = rowByTitle(parent.title);
  await expect(parentRow).toBeVisible();
  // The disclosure's label flips with its state; aria-expanded is the stable handle.
  const toggle = parentRow.getByRole("button", { name: /^(Mở|Thu) công việc con$/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");

  const childRow = rowByTitle(child.title);
  await expect(childRow).toBeVisible({ timeout: NAV_TIMEOUT });
  const next = parentRow.locator("xpath=following-sibling::tr[1]");
  await expect(next).toContainText(child.title);

  const indent = (row: Locator) =>
    row.locator("td span.truncate.text-body").evaluate((span) =>
      Number.parseFloat(getComputedStyle(span.parentElement!).paddingLeft),
    );
  expect(await indent(childRow)).toBeGreaterThan(await indent(parentRow));
  await expectResponsive();
});

test("groups by project, then by priority", async () => {
  await groupBy("Không nhóm", "Dự án");
  await expect(groupButtons().first()).toBeVisible({ timeout: NAV_TIMEOUT });
  // Group rows carry their count after the label; groups below the fold are virtualized.
  await expect
    .poll(async () => (await collectTexts(GROUP_SELECTOR)).map((text) => text.replace(/\d+$/, "").trim()))
    .toEqual(["Alpha", "Beta", "Không có dự án"]);

  await groupBy("Dự án", "Ưu tiên");
  await expect(groupButtons().first()).toHaveText(/^Khẩn cấp\s*\d+$/, { timeout: NAV_TIMEOUT });

  await groupBy("Ưu tiên", "Không nhóm");
  await expect(groupButtons()).toHaveCount(0, { timeout: NAV_TIMEOUT });
  await expectResponsive();
});

test("a select property edits in place and survives reload", async () => {
  await toolbar().getByRole("button", { name: "Cột", exact: true }).click();
  await page.getByRole("menuitemcheckbox", { name: PROPERTY }).click();
  await page.keyboard.press("Escape");
  await expect(tableView().locator("thead").getByRole("button", { name: PROPERTY, exact: true })).toBeVisible();

  await scrollTableTo("top");
  const title = (await titleCells().first().textContent()) ?? "";
  const row = rowByTitle(title);
  const cell = row.getByRole("button", { name: new RegExp(`^${PROPERTY}`) });
  await expect(cell).toBeVisible();

  const saved = page.waitForResponse(
    (res) => /\/tasks\/[0-9A-Z]{26}\/propert/.test(res.url()) && res.request().method() !== "GET",
    { timeout: NAV_TIMEOUT },
  );
  await cell.click();
  await page.getByRole("menuitemradio", { name: "Đang làm", exact: true }).click();
  expect((await saved).ok()).toBe(true);
  await expect(row.getByRole("button", { name: `${PROPERTY}: Đang làm` })).toBeVisible();

  await page.reload();
  await expect(rowByTitle(title).getByRole("button", { name: `${PROPERTY}: Đang làm` })).toBeVisible({
    timeout: NAV_TIMEOUT,
  });
  await expectResponsive();
});

test("keyboard column reorder persists across reload", async () => {
  await expect(titleCells().first()).toBeVisible({ timeout: NAV_TIMEOUT });
  const before = await headerTexts();
  // The title column is pinned; move the first column after it one step right.
  const moving = before[1];
  const grip = tableView().getByRole("button", { name: `Di chuyển cột ${moving}`, exact: true });
  await grip.focus();
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(300);
  await page.keyboard.press("Space");
  await page.waitForTimeout(800);

  const expected = [...before];
  [expected[1], expected[2]] = [expected[2], expected[1]];
  await expect.poll(headerTexts).toEqual(expected);

  await page.reload();
  await expect(titleCells().first()).toBeVisible({ timeout: NAV_TIMEOUT });
  await expect.poll(headerTexts).toEqual(expected);

  await page.getByRole("link", { name: "Dự án", exact: true }).click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: NAV_TIMEOUT });
});

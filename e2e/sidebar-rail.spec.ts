import { expect, test } from "@playwright/test";
import { registerVerified } from "./auth-nav";

// Collapsed to the icon rail, every nav row must still take the click. Group
// labels fade out there but are pulled up over the row above them; while they
// kept pointer events, Inbox and Projects could not be clicked at all.
test.describe.configure({ timeout: 120_000 });

test("every nav row is clickable in the collapsed icon rail", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const stamp = Date.now();
  await registerVerified(page, "Rail", stamp);
  await page.getByRole("button", { name: /Bắt đầu/ }).click();
  await page.getByRole("button", { name: "Bỏ qua" }).click();
  await page.getByLabel("Tên tổ chức").fill(`Rail ${stamp}`);
  await page.getByRole("button", { name: `Tạo Rail ${stamp}` }).click();
  await page.getByLabel("Tên workspace").fill("Đội Rail");
  await page.getByRole("button", { name: "Tạo Đội Rail" }).click();
  await page.getByRole("button", { name: "Bỏ qua, mời sau" }).click();
  await expect(page).toHaveURL(/\/tasks$/, { timeout: 15_000 });
  await page.getByRole("button", { name: "Để sau" }).click({ timeout: 15_000 });

  await page.keyboard.press("ControlOrMeta+b");
  const nav = page.getByRole("navigation", { name: "Điều hướng workspace" });
  await expect(nav.getByRole("link", { name: "Hộp việc" })).toHaveCSS("width", "32px");

  // Hit-test the centre of every row: whatever sits on top there gets the click.
  const blocked = await nav.evaluate((el) =>
    Array.from(el.querySelectorAll<HTMLAnchorElement>("a"))
      .filter((a) => {
        const r = a.getBoundingClientRect();
        return !a.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2));
      })
      .map((a) => a.textContent?.trim()),
  );
  expect(blocked).toEqual([]);

  await nav.getByRole("link", { name: "Hộp việc" }).click();
  await expect(page).toHaveURL(/\/inbox$/, { timeout: 15_000 });
  await nav.getByRole("link", { name: "Dự án" }).click();
  await expect(page).toHaveURL(/\/projects$/, { timeout: 15_000 });
});

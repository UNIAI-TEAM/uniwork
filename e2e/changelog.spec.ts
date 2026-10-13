import { expect, test } from "@playwright/test";

test("public releases have readable groups, stable links and shareable anchors", async ({ page }) => {
  await page.goto("/changelog#release-1-0-0");
  await expect(page.getByRole("heading", { name: "Nhật ký cập nhật", exact: true })).toBeVisible();
  const release = page.locator("#release-1-0-0");
  await expect(release.getByRole("heading", { name: "Tính năng mới", exact: true })).toBeVisible();
  await expect(release.getByRole("heading", { name: "Cải tiến", exact: true })).toBeVisible();
  await expect(release.getByRole("heading", { name: "Sửa lỗi", exact: true })).toBeVisible();
  await expect(release.locator("time")).toHaveAttribute("datetime", "2026-10-12");
  await page.getByRole("navigation", { name: "Các phiên bản", exact: true }).getByRole("link", { name: "12 v1.0.0" }).click();
  await expect(page).toHaveURL(/#release-1-0-0$/);
  await expect(page).toHaveTitle("Nhật ký cập nhật · UniWork");
});

test("both themes preserve reading order without horizontal page overflow", async ({ page }) => {
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/changelog");
    for (const theme of ["light", "dark"]) {
      await page.getByRole("button", { name: "Giao diện", exact: true }).click();
      await page.getByRole("menuitemradio", { name: theme === "light" ? "Sáng" : "Tối", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
      await expect(page.getByRole("navigation", { name: "Các phiên bản", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
  }
});

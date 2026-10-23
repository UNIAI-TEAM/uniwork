import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { auditText } from "./contrast";
import { landingReady, gotoLanding } from "./landing-ready";

for (const width of [1440, 390]) {
 test(`demo request keeps details on failure and confirms a saved receipt at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await gotoLanding(page, "/");
  await landingReady(page);
  await page.locator(".landing-hero-actions").getByRole("link", { name: "Yêu cầu demo" }).click();
  await expect(page).toHaveURL(/\/request-demo$/);
  let attempts = 0;
  const keys: string[] = [];
  await page.route("**/api/v1/demo-requests", async route => {
   attempts++; keys.push(route.request().headers()["idempotency-key"]);
   await route.fulfill({ status: attempts === 1 ? 503 : 201, contentType: "application/json", body: JSON.stringify(attempts === 1 ? { error: { code: "unavailable", message: "Unavailable" } } : { request_id: "01DEMORECEIPT00000000000000" }) });
  });
  await page.getByRole("button", { name: "Gửi yêu cầu demo" }).click();
  expect(attempts).toBe(0);
  await page.getByLabel("Họ và tên").fill("Nguyễn Lan");
  await page.getByLabel("Email công việc").fill("lan@example.com");
  await page.getByLabel("Công ty hoặc đội ngũ").fill("Acme");
  await page.getByRole("combobox", { name: "Quy mô đội ngũ" }).click();
  await page.getByRole("option", { name: "11-50 người", exact: true }).click();
  await page.getByLabel("Bạn muốn tìm hiểu điều gì? (không bắt buộc)").fill("Quản lý dự án của đội ngũ");
  const dir = resolve(import.meta.dirname, "../.impeccable/review");
  await mkdir(dir, { recursive: true });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: resolve(dir, `request-demo-${width}.png`), fullPage: true, style: "nextjs-portal { visibility: hidden !important; }" });
  await page.getByRole("button", { name: "Gửi yêu cầu demo" }).click();
  await expect(page.locator(".demo-request-form").getByRole("alert")).toContainText("Chưa gửi được yêu cầu");
  await expect(page.getByLabel("Họ và tên")).toHaveValue("Nguyễn Lan");
  await page.getByRole("button", { name: "Gửi yêu cầu demo" }).click();
  await expect(page.locator(".demo-request-panel").getByRole("status")).toContainText("Đã nhận yêu cầu demo");
  await expect(page.locator(".demo-request-panel").getByRole("status")).toContainText("lan@example.com");
  expect(keys[1]).toBe(keys[0]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
 });
}

for (const mode of ["light", "dark"] as const) {
 test(`hero and demo text stay readable in ${mode} mode`, async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce", colorScheme: mode });
  await gotoLanding(page, "/");
  await landingReady(page);
  const hero = await auditText(page, ".landing-hero");
  expect(hero.fails).toEqual([]);
  await gotoLanding(page, "/request-demo");
  await landingReady(page);
  const form = await auditText(page, ".demo-request-page");
  expect(form.fails).toEqual([]);
 });
}

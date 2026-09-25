import { selectWorkspaceFeature, openManualPreview } from "./landing-catalog-helpers";
import { expect, test } from "@playwright/test";

test("online meetings are a view of the same workspace", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/#hop");
  const workspace = page.locator("#product-preview");
  await openManualPreview(page);
  await expect(workspace.getByRole("tab", { name: "Họp trực tuyến", exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(workspace.locator(".meeting-room")).toBeVisible();
  await expect(page.locator(".product-index, .product-story-band, .meeting-section")).toHaveCount(0);
  await expect(page.locator(".landing-future-story > section")).toHaveCount(1);
});

test("meeting controls are accessible local simulations, with conditional AI follow-up", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: {
      getUserMedia: () => { throw new Error("Landing must not request devices"); },
      getDisplayMedia: () => { throw new Error("Landing must not capture a screen"); },
    } });
  });
  const errors: string[] = [];
  const writes: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.method() !== "GET" && /\/api\/v1\/.*meeting/.test(request.url())) writes.push(request.url());
  });
  await page.goto("/");
  await selectWorkspaceFeature(page, "meetings");
  const room = page.locator(".meeting-room");
  await expect(room).toContainText("Không truy cập mic, camera hay màn hình của bạn");
  await room.getByRole("button", { name: "Mic", exact: true }).click();
  await expect(room.getByRole("button", { name: "Mic", exact: true })).toHaveAttribute("aria-pressed", "true");
  await room.getByRole("button", { name: "Camera", exact: true }).click();
  await expect(room.locator(".meeting-participant[data-self=true]")).toHaveAttribute("data-camera", "on");
  await room.getByRole("button", { name: "Chia sẻ màn hình", exact: true }).click();
  await expect(room.locator(".meeting-shared-screen")).toHaveCount(0);
  await room.getByRole("button", { name: "Chia sẻ màn hình", exact: true }).click();
  await expect(room.locator(".meeting-shared-screen")).toBeVisible();
  await room.getByRole("button", { name: "Người tham gia", exact: true }).click();
  await expect(room.locator("#meeting-demo-people")).toContainText("Phòng chờ");
  await page.getByRole("button", { name: "Sau cuộc họp: tóm tắt và việc cần làm" }).click();
  await expect(page.locator(".meeting-follow-up")).toContainText("Bạn chọn người phụ trách và xác nhận tạo việc");
  expect(errors).toEqual([]);
  expect(writes).toEqual([]);
});

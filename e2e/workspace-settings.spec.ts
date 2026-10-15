import { expect, test } from "@playwright/test";
import { onboardToWorkspace, workspaceSeed } from "./onboard";

test.describe.configure({ timeout: 180_000 });

const stamp = Date.now();

test("workspace settings: đổi địa chỉ, link cũ tự chuyển sang địa chỉ mới", async ({ page }) => {
  const w = workspaceSeed("wsinfo", "slug", stamp);
  await onboardToWorkspace(page, w);
  await page.goto(`/${w.orgSlug}/${w.wsSlug}/settings?tab=workspace`);

  await page.getByRole("button", { name: "Đổi địa chỉ" }).click();
  const dialog = page.getByRole("dialog");
  const next = `${w.wsSlug}-moi`;
  await dialog.getByRole("textbox", { name: "Địa chỉ mới" }).fill(next);
  await dialog.getByRole("button", { name: "Đổi địa chỉ" }).click();
  await expect(page).toHaveURL(new RegExp(`/${w.orgSlug}/${next}/settings`), { timeout: 20_000 });

  // A link from before the change still opens the workspace, under the new address.
  await page.goto(`/${w.orgSlug}/${w.wsSlug}/tasks?view=board`);
  await expect(page).toHaveURL(new RegExp(`/${w.orgSlug}/${next}/tasks\\?view=board`), { timeout: 20_000 });
});

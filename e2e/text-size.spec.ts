import { expect, test, type Page } from "@playwright/test";
import { onboardToWorkspace, workspaceSeed } from "./onboard";

// Spec 2026-10-13-text-size-design.md: the text size picked in Settings →
// Preferences scales every reading step, survives a reload without a flash or
// a hydration error, and leaves no main screen scrolling sideways at the
// largest level.
//
// Requires `make dev`.
const w = workspaceSeed("textsize", "owner", Date.now());

function bodyFontSize(page: Page): Promise<string> {
  return page.evaluate(() => getComputedStyle(document.body).fontSize);
}

test("the largest text size scales the app, survives a reload and keeps screens in bounds", async ({ page }) => {
  const hydrationErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" && /hydrat/i.test(msg.text())) hydrationErrors.push(msg.text());
  });

  await onboardToWorkspace(page, w);
  const base = `/${w.orgSlug}/${w.wsSlug}`;

  await page.goto(`${base}/settings?tab=preferences`);
  const picker = page.getByRole("group", { name: "Cỡ chữ" });
  await expect(picker).toBeVisible({ timeout: 15_000 });
  expect(await bodyFontSize(page)).toBe("14px");

  // The radio is sr-only; the label is what a person clicks.
  await picker.getByText("Rất lớn", { exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
  expect(await bodyFontSize(page)).toBe("18px");

  // Stylesheets that read var(--text-*) — the editor — follow too, not only utilities.
  const viaVariable = await page.evaluate(() => {
    const probe = document.createElement("div");
    probe.style.fontSize = "var(--text-body)";
    document.body.append(probe);
    const size = getComputedStyle(probe).fontSize;
    probe.remove();
    return size;
  });
  expect(viaVariable).toBe("18px");

  await page.reload();
  // The hook never writes the attribute on mount, so only the boot script can have set it.
  await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
  expect(await bodyFontSize(page)).toBe("18px");
  await expect(page.getByRole("radio", { name: "Rất lớn" })).toBeChecked();

  for (const path of ["", "/tasks", "/chat", "/documents", "/settings?tab=preferences"]) {
    await page.goto(`${base}${path}`);
    await page.waitForLoadState("load");
    await expect(page.locator("html")).toHaveAttribute("data-text-size", "xlarge");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path || "/"} scrolls sideways at the largest text size`).toBeLessThanOrEqual(0);
  }

  expect(hydrationErrors).toEqual([]);
});

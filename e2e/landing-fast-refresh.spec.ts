import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";

// Fast Refresh needs a local dev server and changes a dictionary temporarily.
test.skip(process.env.E2E_FAST_REFRESH !== "1", "Run explicitly against next dev with E2E_FAST_REFRESH=1");

for (const locale of ["en", "vi"] as const) {
  test(`a mounted ${locale} landing updates dictionary copy without losing state`, async ({ page, context, baseURL }) => {
    const path = fileURLToPath(new URL(`../packages/core/i18n/locales/${locale}.json`, import.meta.url));
    const original = await readFile(path, "utf8");
    const dictionary = JSON.parse(original) as { landing: { businessOs: { preview: { askUni: string } } } };
    const initialLabel = dictionary.landing.businessOs.preview.askUni;
    const updatedLabel = `${initialLabel} · refresh`;
    const updated = original.replace(`"askUni": "${initialLabel}"`, `"askUni": "${updatedLabel}"`);
    expect(updated).not.toBe(original);

    await context.addCookies([{ name: "uniwork-locale", value: locale, url: baseURL! }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/#business-os");
    const os = page.locator("#business-os");
    const label = os.locator("[data-showcase=gateway] .business-os-showcase-label > span");
    const project = os.locator("[data-showcase=projects] button");
    await expect(label).toHaveText(initialLabel);
    await project.click();
    await expect(project).toHaveAttribute("aria-pressed", "true");

    try {
      await writeFile(path, updated);
      await expect(label).toHaveText(updatedLabel, { timeout: 15_000 });
      await expect(project).toHaveAttribute("aria-pressed", "true");
      await expect(page.locator("html")).toHaveAttribute("lang", locale);
      expect(await os.innerText()).not.toContain("landing.businessOs.");
    } finally {
      // Preserve any independent edit made while this opt-in test was running.
      if (await readFile(path, "utf8") === updated) await writeFile(path, original);
    }
    await expect(label).toHaveText(initialLabel, { timeout: 15_000 });
  });
}

import { expect, test } from "@playwright/test";
import en from "../packages/core/i18n/locales/en.json" with { type: "json" };
import vi from "../packages/core/i18n/locales/vi.json" with { type: "json" };

for (const [locale, dictionary] of Object.entries({ en, vi })) {
  test(`landing SSR and hydration use the same current ${locale} copy`, async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: "uniwork-locale", value: locale, url: baseURL! }]);
    await page.emulateMedia({ reducedMotion: "reduce" });
    const hydrationErrors: string[] = [];
    const recordHydrationError = (message: string) => {
      if (/hydration|server rendered|didn't match/i.test(message)) hydrationErrors.push(message);
    };
    page.on("pageerror", error => recordHydrationError(error.message));
    page.on("console", message => {
      if (message.type() === "error") recordHydrationError(message.text());
    });

    for (const load of ["initial", "reload"] as const) {
      const response = load === "initial" ? await page.goto("/") : await page.reload();
      const html = await response!.text();
      const serverDescription = html.match(/<p class="landing-hero-description">([^<]+)<\/p>/)?.[1];
      expect(serverDescription, "server must render the current dictionary").toBe(dictionary.landing.studio.heroDescription);
      await expect(page.locator(".landing-hero-description")).toHaveText(serverDescription!);
      const os = page.locator("#business-os");
      expect(await os.innerText()).not.toContain("landing.businessOs.");
      await expect(os.locator("[data-showcase=gateway] .business-os-showcase-label > span")).toHaveText(dictionary.landing.businessOs.preview.askUni);
      await os.getByRole("button", { name: dictionary.landing.businessOs.availability, exact: true }).click();
      await expect(os.locator(".business-os-availability-content")).toBeVisible();
      expect(hydrationErrors).toEqual([]);
    }
  });
}

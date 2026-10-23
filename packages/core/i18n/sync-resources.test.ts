import { describe, expect, it, vi } from "vitest";
import { createI18n } from "./create-i18n";
import { syncI18nResources } from "./index";

describe("browser dictionary refresh", () => {
  it("replaces stale strings and notifies mounted consumers without changing language", () => {
    const instance = createI18n("en", {
      en: { translation: { landing: { title: "Old" } } },
      vi: { translation: { landing: { title: "Cũ" } } },
    });
    const listener = vi.fn();
    instance.on("languageChanged", listener);
    syncI18nResources(instance, { en: { landing: { title: "New", motion: "Move" } }, vi: { landing: { title: "Mới" } } });
    expect(instance.t("landing.motion")).toBe("Move");
    expect(instance.t("landing.title")).toBe("New");
    expect(instance.language).toBe("en");
    expect(listener).toHaveBeenCalledWith("en");
  });
});

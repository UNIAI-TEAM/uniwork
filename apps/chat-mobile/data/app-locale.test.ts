import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ value: null as string | null, fail: false }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(async () => {
    if (store.fail) throw new Error("locked");
    return store.value;
  }),
}));
const device = vi.hoisted(() => ({ tags: ["en-US"] }));
vi.mock("expo-localization", () => ({ getLocales: () => device.tags.map((languageTag) => ({ languageTag })) }));

async function load() {
  vi.resetModules();
  const locale = await import("./app-locale");
  const { i18n } = await import("@/lib/i18n/singleton");
  return { ...locale, i18n };
}

beforeEach(() => {
  store.value = null;
  store.fail = false;
  device.tags = ["en-US"];
});

describe("applyStoredLocale", () => {
  it("takes the Settings choice over the phone's language", async () => {
    store.value = "vi";
    const { applyStoredLocale, i18n } = await load();
    expect(await applyStoredLocale()).toBe("vi");
    expect(i18n.language).toBe("vi");
  });

  it("takes the phone's language without a choice, or with an unreadable one", async () => {
    const { applyStoredLocale, i18n } = await load();
    expect(await applyStoredLocale()).toBe("en");
    expect(i18n.language).toBe("en");
    store.fail = true;
    device.tags = ["fr-FR"];
    const changed = vi.spyOn(i18n, "changeLanguage");
    expect(await applyStoredLocale()).toBe("vi");
    expect(changed).toHaveBeenCalledWith("vi");
    // The same language again: nothing to switch.
    changed.mockClear();
    expect(await applyStoredLocale()).toBe("vi");
    expect(changed).not.toHaveBeenCalled();
  });

  it("ignores a stored value that is not a language the app speaks", async () => {
    store.value = "de";
    const { applyStoredLocale, LOCALE_KEY } = await load();
    expect(LOCALE_KEY).toBe("locale_preference");
    expect(await applyStoredLocale()).toBe("en");
  });
});

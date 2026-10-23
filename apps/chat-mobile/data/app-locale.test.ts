import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ value: null as string | null, fail: false }));
const getItemAsync = vi.hoisted(() => vi.fn<(key: string) => Promise<string | null>>());
vi.mock("expo-secure-store", () => ({
  AFTER_FIRST_UNLOCK: 0,
  getItemAsync: getItemAsync.mockImplementation(async () => {
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
    device.tags = ["vi-VN"];
    const changed = vi.spyOn(i18n, "changeLanguage");
    expect(await applyStoredLocale()).toBe("vi");
    expect(changed).toHaveBeenCalledWith("vi");
    // The same language again: nothing to switch.
    changed.mockClear();
    expect(await applyStoredLocale()).toBe("vi");
    expect(changed).not.toHaveBeenCalled();
  });

  // The system's per-app language changed after the in-app choice: the headless task follows the system, as the UI does.
  it("follows the phone once its language changed after the choice", async () => {
    store.value = "vi|vi";
    const { applyStoredLocale } = await load();
    expect(await applyStoredLocale()).toBe("en");
    store.value = "vi|en";
    expect(await applyStoredLocale()).toBe("vi");
  });

  it("ignores a stored value that is not a language the app speaks", async () => {
    store.value = "de";
    const { applyStoredLocale } = await load();
    expect(await applyStoredLocale()).toBe("en");
    expect(getItemAsync).toHaveBeenLastCalledWith("locale_preference", { keychainAccessible: 0 });
  });
});

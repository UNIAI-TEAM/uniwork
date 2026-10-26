import { describe, expect, it, vi } from "vitest";
import type { SupportedLocale } from "@/lib/i18n/singleton";
import { createLocalePreference, encodeLocaleChoice, resolveLocaleChoice } from "./locale-preference";

const deps = (saved: Promise<string | null>, system: SupportedLocale = "vi") => ({
  /** What the phone speaks now; a case changes it to stand for Android 13+ Settings › App languages. */
  phone: { system },
  system(): SupportedLocale {
    return this.phone.system;
  },
  read: vi.fn(() => saved),
  write: vi.fn(async () => {}),
  apply: vi.fn(),
});

describe("resolveLocaleChoice", () => {
  it("keeps a choice made under the same system language, and one saved before the system was recorded", () => {
    expect(resolveLocaleChoice(encodeLocaleChoice("en", "vi"), "vi")).toEqual({ locale: "en", replace: false });
    expect(resolveLocaleChoice("en", "vi")).toEqual({ locale: "en", replace: false });
  });

  // iOS Settings › UniChat › Language or Android 13's app languages changed after the in-app choice: the system wins.
  it("follows the system once its language changed after the choice", () => {
    expect(resolveLocaleChoice("vi|vi", "en")).toEqual({ locale: "en", replace: true });
  });

  it("follows the system for nothing saved or a value it does not know", () => {
    expect(resolveLocaleChoice(null, "en")).toEqual({ locale: "en", replace: false });
    expect(resolveLocaleChoice("de|vi", "vi")).toEqual({ locale: "vi", replace: false });
    expect(resolveLocaleChoice("en|xx", "vi")).toEqual({ locale: "en", replace: false });
  });
});

describe("createLocalePreference", () => {
  it("starts in the system language, reads the saved choice once per launch, applies it and turns ready", async () => {
    const d = deps(Promise.resolve("en|vi"));
    const locale = createLocalePreference(d);
    expect(locale.store.getState()).toEqual({ locale: "vi", ready: false });
    await Promise.all([locale.load(), locale.load()]);
    await locale.load();
    expect(d.read).toHaveBeenCalledTimes(1);
    expect(d.apply).toHaveBeenCalledExactlyOnceWith("en");
    expect(locale.store.getState()).toEqual({ locale: "en", ready: true });
    expect(d.write).not.toHaveBeenCalled();
  });

  it("is ready with the system language for nothing saved, the same language, or a read that fails", async () => {
    for (const saved of [Promise.resolve(null), Promise.resolve("vi|vi"), Promise.reject(new Error("keychain"))]) {
      const d = deps(saved);
      const locale = createLocalePreference(d);
      await locale.load();
      expect(locale.store.getState()).toEqual({ locale: "vi", ready: true });
      expect(d.apply).not.toHaveBeenCalled();
    }
  });

  it("replaces a choice the system has since overruled, so it cannot come back", async () => {
    const d = deps(Promise.resolve("vi|vi"), "en");
    const locale = createLocalePreference(d);
    await locale.load();
    expect(locale.store.getState()).toEqual({ locale: "en", ready: true });
    expect(d.write).toHaveBeenCalledWith("en|en");
    expect(d.apply).not.toHaveBeenCalled();
  });

  it("applies and saves a choice at once with the system language, and a choice made during the read wins", async () => {
    let answer: (value: string) => void = () => undefined;
    const d = deps(new Promise((resolve) => (answer = resolve)));
    d.write.mockRejectedValueOnce(new Error("keychain"));
    const locale = createLocalePreference(d);
    const loaded = locale.load();
    locale.set("en");
    expect(locale.store.getState()).toEqual({ locale: "en", ready: true });
    expect(d.apply).toHaveBeenLastCalledWith("en");
    expect(d.write).toHaveBeenCalledWith("en|vi");
    answer("vi|vi");
    await loaded;
    expect(locale.store.getState().locale).toBe("en");
    expect(d.apply).toHaveBeenCalledTimes(1);
  });

  // Android 13+ Settings › App languages changes the language while UniChat keeps running (MainActivity is recreated
  // over the same JS runtime); iOS relaunches the app instead. The next return to the app follows it.
  it("follows a system language changed while the app runs, on the next refresh, and saves it", async () => {
    const d = deps(Promise.resolve("en|vi"));
    const locale = createLocalePreference(d);
    await locale.load();
    expect(locale.store.getState().locale).toBe("en");
    locale.refresh();
    expect(d.apply).toHaveBeenCalledTimes(1);
    d.phone.system = "en";
    locale.refresh();
    // Already English: nothing to apply, but the choice is now the system's, so switching the system back wins too.
    expect(d.apply).toHaveBeenCalledTimes(1);
    expect(d.write).toHaveBeenLastCalledWith("en|en");
    d.phone.system = "vi";
    locale.refresh();
    expect(locale.store.getState()).toEqual({ locale: "vi", ready: true });
    expect(d.apply).toHaveBeenLastCalledWith("vi");
    expect(d.write).toHaveBeenLastCalledWith("vi|vi");
    locale.refresh();
    expect(d.write).toHaveBeenCalledTimes(2);
  });

  it("leaves a change seen before the saved choice is read to that read, which resolves against the new system", async () => {
    let answer: (value: string) => void = () => undefined;
    const d = deps(new Promise((resolve) => (answer = resolve)));
    const locale = createLocalePreference(d);
    const loaded = locale.load();
    d.phone.system = "en";
    locale.refresh();
    expect(d.apply).not.toHaveBeenCalled();
    expect(d.write).not.toHaveBeenCalled();
    answer("vi|vi");
    await loaded;
    expect(locale.store.getState()).toEqual({ locale: "en", ready: true });
    expect(d.write).toHaveBeenCalledExactlyOnceWith("en|en");
  });

  it("records a later in-app choice with the system language of that moment", () => {
    const d = deps(Promise.resolve(null));
    const locale = createLocalePreference(d);
    d.phone.system = "en";
    locale.set("vi");
    expect(d.write).toHaveBeenCalledWith("vi|en");
    // The choice saw the new system already: returning to the app does not overrule it.
    locale.refresh();
    expect(locale.store.getState().locale).toBe("vi");
    expect(d.write).toHaveBeenCalledTimes(1);
  });
});

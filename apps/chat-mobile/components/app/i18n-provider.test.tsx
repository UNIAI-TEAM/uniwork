// The app's language: the device language starts it, a choice saved in Settings
// wins once read (data/locale-preference.ts holds the rules), a new choice is
// applied at once and saved with the system language of the moment, and the
// device's 12/24-hour clock reaches the formatters at start and on each return.
// The provider module reads the saved choice once per launch, so each case
// loads a fresh copy of it.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as React from "react";
import * as ReactI18next from "react-i18next";
import { AppState, Pressable, Text } from "react-native";
import type * as ProviderModule from "./i18n-provider";

const device = { tags: ["fr-FR", "vi-VN"], uses24hourClock: true as boolean | null };
jest.mock("expo-localization", () => ({
  getLocales: () => device.tags.map((languageTag) => ({ languageTag })),
  getCalendars: () => [{ uses24hourClock: device.uses24hourClock }],
}));
jest.mock("@/data/device-preferences", () => ({ readDevicePreference: jest.fn(), writeDevicePreference: jest.fn() }));

// The registry's React Native (not a namespace import: the lint keeps Modal out of reach).
const outerReactNative = jest.requireActual<typeof import("react-native")>("react-native");

type Modules = {
  provider: typeof ProviderModule;
  prefs: { readDevicePreference: jest.Mock; writeDevicePreference: jest.Mock };
  i18n: typeof import("@/lib/i18n/singleton").i18n;
  format: typeof import("@/lib/locale-format");
};

/** A fresh provider module (its once-per-launch read included) over the mocks the case set up. */
function load(saved: () => Promise<string | null>): Modules {
  let modules!: Modules;
  jest.isolateModules(() => {
    // One React (and React Native) for the renderer and the fresh module: hooks need the same copy.
    jest.doMock("react", () => React);
    jest.doMock("react-native", () => outerReactNative);
    jest.doMock("react-i18next", () => ReactI18next);
    const prefs = jest.requireMock<Modules["prefs"]>("@/data/device-preferences");
    prefs.readDevicePreference.mockImplementation(saved);
    prefs.writeDevicePreference.mockResolvedValue(undefined);
    modules = {
      provider: jest.requireActual("./i18n-provider"),
      prefs,
      i18n: jest.requireActual<typeof import("@/lib/i18n/singleton")>("@/lib/i18n/singleton").i18n,
      format: jest.requireActual("@/lib/locale-format"),
    };
  });
  return modules;
}

async function mount({ provider }: Modules) {
  function Probe() {
    const { locale, setLocale } = provider.useLocalePreference();
    const ready = provider.useLocaleReady();
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="english" onPress={() => setLocale("en")}>
        <Text>{`${locale}${ready ? " ready" : ""}`}</Text>
      </Pressable>
    );
  }
  // render() from RNTL directly: test/render's wrapper brings its own i18n instance.
  return render(
    <provider.I18nProvider>
      <Probe />
    </provider.I18nProvider>,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  device.tags = ["fr-FR", "vi-VN"];
  device.uses24hourClock = true;
});

it("starts in the device language the app supports, and is ready once the read answers", async () => {
  const modules = load(() => Promise.resolve(null));
  await mount(modules);
  expect(await screen.findByText("vi ready")).toBeTruthy();
  expect(modules.i18n.language).toBe("vi");
  expect(modules.prefs.readDevicePreference).toHaveBeenCalledWith("locale");
});

it("reads English on a phone that speaks neither language", async () => {
  device.tags = ["ja-JP"];
  const modules = load(() => Promise.resolve(null));
  await mount(modules);
  expect(await screen.findByText("en ready")).toBeTruthy();
  expect(modules.i18n.language).toBe("en");
});

it("switches to the language saved in Settings once it is read", async () => {
  const modules = load(() => Promise.resolve("en|vi"));
  await mount(modules);
  expect(await screen.findByText("en ready")).toBeTruthy();
  expect(modules.i18n.language).toBe("en");
});

it("waits for the read before it is ready, and an unreadable store leaves the device language", async () => {
  let fail: (error: Error) => void = () => undefined;
  const modules = load(() => new Promise((_, reject) => (fail = reject)));
  await mount(modules);
  expect(screen.getByText("vi")).toBeTruthy();
  await act(async () => fail(new Error("keystore")));
  expect(await screen.findByText("vi ready")).toBeTruthy();
});

it("applies a new choice at once and saves it with the system language, even when saving fails", async () => {
  const modules = load(() => Promise.resolve(null));
  modules.prefs.writeDevicePreference.mockRejectedValueOnce(new Error("keystore"));
  await mount(modules);
  await fireEvent.press(screen.getByRole("button", { name: "english" }));
  expect(screen.getByText("en ready")).toBeTruthy();
  expect(modules.i18n.language).toBe("en");
  expect(modules.prefs.writeDevicePreference).toHaveBeenCalledWith("locale", "en|vi");
});

it("follows the device's clock at start and again when the app comes back", async () => {
  const modules = load(() => Promise.resolve(null));
  const at = new Date(2026, 9, 22, 21, 5).getTime();
  const time = () => modules.format.dateTimeFormat("en", { hour: "2-digit", minute: "2-digit" }).format(at);
  const listeners: ((state: string) => void)[] = [];
  const remove = jest.fn();
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove };
  });
  const { unmount } = await mount(modules);
  expect(time()).toBe("21:05");
  device.uses24hourClock = false;
  await act(async () => listeners.forEach((listener) => listener("background")));
  expect(time()).toBe("21:05");
  await act(async () => listeners.forEach((listener) => listener("active")));
  expect(time()).toMatch(/^0?9:05\s?pm$/i);
  await unmount();
  expect(remove).toHaveBeenCalled();
  modules.format.setDeviceClock(null);
});

// Android 13+ Settings › App languages, changed while UniChat waits in the background: the activity comes back over the
// same JS runtime, so the provider asks the phone again on the return and the system's language wins.
it("follows a system language changed while the app was in the background", async () => {
  const modules = load(() => Promise.resolve("vi|vi"));
  const listeners: ((state: string) => void)[] = [];
  jest.spyOn(AppState, "addEventListener").mockImplementation((_type, listener) => {
    listeners.push(listener as (state: string) => void);
    return { remove: jest.fn() };
  });
  await mount(modules);
  expect(await screen.findByText("vi ready")).toBeTruthy();
  device.tags = ["en-GB"];
  await act(async () => listeners.forEach((listener) => listener("active")));
  expect(screen.getByText("en ready")).toBeTruthy();
  expect(modules.i18n.language).toBe("en");
  expect(modules.prefs.writeDevicePreference).toHaveBeenCalledWith("locale", "en|en");
});

it("outside the provider reads the default language and ignores a choice", async () => {
  const modules = load(() => Promise.resolve(null));
  function Probe() {
    const { locale, setLocale } = modules.provider.useLocalePreference();
    return (
      <Pressable accessibilityRole="button" accessibilityLabel="english" onPress={() => setLocale("en")}>
        <Text>{locale}</Text>
      </Pressable>
    );
  }
  await render(<Probe />);
  await fireEvent.press(screen.getByRole("button", { name: "english" }));
  expect(screen.getByText("vi")).toBeTruthy();
  expect(modules.prefs.writeDevicePreference).not.toHaveBeenCalled();
});

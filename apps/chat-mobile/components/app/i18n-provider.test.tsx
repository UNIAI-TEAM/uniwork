// The app's language: the device language starts it, a choice saved in Settings
// wins once read, and a new choice is applied at once and saved for next time.
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { readDevicePreference, writeDevicePreference } from "@/data/device-preferences";
import { i18n } from "@/lib/i18n/singleton";
import { I18nProvider, useLocalePreference } from "./i18n-provider";

jest.mock("expo-localization", () => ({ getLocales: () => [{ languageTag: "fr-FR" }, { languageTag: "vi-VN" }] }));
jest.mock("@/data/device-preferences", () => ({ readDevicePreference: jest.fn(), writeDevicePreference: jest.fn() }));

const read = jest.mocked(readDevicePreference);
const write = jest.mocked(writeDevicePreference);

function Probe() {
  const { locale, setLocale } = useLocalePreference();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="english" onPress={() => setLocale("en")}>
      <Text>{locale}</Text>
    </Pressable>
  );
}

/** A promise the test settles by hand, so the order of the read and the unmount is the test's. */
function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  jest.clearAllMocks();
  write.mockResolvedValue(undefined);
});

afterAll(() => {
  void i18n.changeLanguage("vi");
});

it("starts in the device language the app supports", async () => {
  read.mockResolvedValue(null);
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(screen.getByText("vi")).toBeTruthy();
  expect(i18n.language).toBe("vi");
  expect(read).toHaveBeenCalledWith("locale");
});

it("switches to the language saved in Settings once it is read", async () => {
  read.mockResolvedValue("en");
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  expect(await screen.findByText("en")).toBeTruthy();
  expect(i18n.language).toBe("en");
  await act(() => i18n.changeLanguage("vi"));
});

it("ignores a saved value it does not know, and an unreadable store", async () => {
  for (const outcome of [() => Promise.resolve("de"), () => Promise.reject(new Error("keystore"))]) {
    read.mockImplementationOnce(outcome);
    const { unmount } = await render(
      <I18nProvider>
        <Probe />
      </I18nProvider>,
    );
    await act(async () => undefined);
    expect(screen.getByText("vi")).toBeTruthy();
    await unmount();
  }
});

it("does not apply a saved language read after the provider is gone", async () => {
  const pending = deferred<string | null>();
  read.mockReturnValueOnce(pending.promise);
  const { unmount } = await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  await unmount();
  await act(async () => pending.resolve("en"));
  expect(i18n.language).toBe("vi");
});

it("applies a new choice at once and saves it, even when saving fails", async () => {
  read.mockResolvedValue(null);
  write.mockRejectedValueOnce(new Error("keystore"));
  await render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );
  await fireEvent.press(screen.getByRole("button", { name: "english" }));
  expect(screen.getByText("en")).toBeTruthy();
  expect(i18n.language).toBe("en");
  expect(write).toHaveBeenCalledWith("locale", "en");
  await act(() => i18n.changeLanguage("vi"));
});

it("outside the provider reads the default language and ignores a choice", async () => {
  await render(<Probe />);
  await fireEvent.press(screen.getByRole("button", { name: "english" }));
  expect(screen.getByText("vi")).toBeTruthy();
  expect(write).not.toHaveBeenCalled();
});

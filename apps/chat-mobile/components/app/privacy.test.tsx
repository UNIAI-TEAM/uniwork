// The app lock and screen security wired to the phone (privacy.ts): the Keychain read and write, expo-screen-capture
// per platform, and expo-local-authentication's answers, refusals included.
import { act, renderHook } from "@testing-library/react-native";
import * as LocalAuthentication from "expo-local-authentication";
import * as ScreenCapture from "expo-screen-capture";
import { Platform } from "react-native";
import { readDevicePreference, writeDevicePreference } from "@/data/device-preferences";
import { authenticateOwner, deviceCanLock, loadPrivacySettings, updatePrivacySettings, usePrivacySettings } from "./privacy";

jest.mock("@/data/device-preferences", () => ({
  readDevicePreference: jest.fn(async () => JSON.stringify({ appLock: false, relockAfterMs: 0, screenSecurity: true })),
  writeDevicePreference: jest.fn(async () => undefined),
}));

const capture = jest.mocked(ScreenCapture);
const auth = jest.mocked(LocalAuthentication);

beforeEach(() => jest.clearAllMocks());

describe("privacy settings on the phone", () => {
  it("loads the saved choices from the Keychain and blocks capture and the app switcher on iOS", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await act(() => loadPrivacySettings());
    expect(readDevicePreference).toHaveBeenCalledWith("privacy");
    const { result } = await renderHook(() => usePrivacySettings());
    expect(result.current).toEqual({ settings: { appLock: false, relockAfterMs: 0, screenSecurity: true }, loaded: true });
    await act(async () => undefined);
    expect(capture.preventScreenCaptureAsync).toHaveBeenCalledWith("unichat-screen-security");
    expect(capture.enableAppSwitcherProtectionAsync).toHaveBeenCalledTimes(1);
  });

  it("saves a choice, allows capture again and leaves the app switcher alone on Android", async () => {
    jest.replaceProperty(Platform, "OS", "android");
    await act(() => updatePrivacySettings({ screenSecurity: false }));
    await act(async () => undefined);
    expect(writeDevicePreference).toHaveBeenCalledWith("privacy", JSON.stringify({ appLock: false, relockAfterMs: 0, screenSecurity: false }));
    expect(capture.allowScreenCaptureAsync).toHaveBeenCalledWith("unichat-screen-security");
    expect(capture.enableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
    expect(capture.disableAppSwitcherProtectionAsync).not.toHaveBeenCalled();
  });

  it("on iOS keeps the app switcher protected while the lock is on, and lifts it when both are off", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await act(() => updatePrivacySettings({ appLock: true }));
    await act(async () => undefined);
    expect(capture.enableAppSwitcherProtectionAsync).toHaveBeenCalledTimes(1);
    await act(() => updatePrivacySettings({ appLock: false }));
    await act(async () => undefined);
    expect(capture.disableAppSwitcherProtectionAsync).toHaveBeenCalledTimes(1);
  });

  it("can lock only a phone with a passcode, fingerprint or face set up; a failing check says no", async () => {
    auth.getEnrolledLevelAsync.mockResolvedValueOnce(LocalAuthentication.SecurityLevel.SECRET);
    expect(await deviceCanLock()).toBe(true);
    auth.getEnrolledLevelAsync.mockResolvedValueOnce(LocalAuthentication.SecurityLevel.NONE);
    expect(await deviceCanLock()).toBe(false);
    auth.getEnrolledLevelAsync.mockRejectedValueOnce(new Error("no module"));
    expect(await deviceCanLock()).toBe(false);
  });

  it("asks for the owner with the passcode as a fallback, and reads a cancel or a failure as no", async () => {
    expect(await authenticateOwner("Mở khoá UniChat", "Hủy")).toBe(true);
    expect(auth.authenticateAsync).toHaveBeenCalledWith({ promptMessage: "Mở khoá UniChat", cancelLabel: "Hủy", disableDeviceFallback: false });
    auth.authenticateAsync.mockResolvedValueOnce({ success: false, error: "user_cancel" });
    expect(await authenticateOwner("p", "c")).toBe(false);
    auth.authenticateAsync.mockRejectedValueOnce(new Error("busy"));
    expect(await authenticateOwner("p", "c")).toBe(false);
  });
});

// Settings › Privacy & security (privacy-section.tsx): turning the lock on or off proves the owner first, a phone without a
// screen lock says so, screen security switches at once, and the relock delay shows only with the lock on.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo, Text } from "react-native";
import { createStore } from "zustand/vanilla";
import type { PrivacyState } from "@/data/privacy-settings";
import { DEFAULT_PRIVACY_SETTINGS, type PrivacySettings } from "@/lib/app-lock";
import { render, viText } from "@/test/render";
import { PrivacySection } from "./privacy-section";

const mockPrivacy = createStore<PrivacyState>(() => ({ settings: DEFAULT_PRIVACY_SETTINGS, loaded: true, restored: true }));
const mockCanLock = jest.fn(async () => true);
const mockAuthenticate = jest.fn(async (_prompt: string, _cancel: string) => true);
const mockUpdate = jest.fn((patch: Partial<PrivacySettings>) => mockPrivacy.setState((s) => ({ settings: { ...s.settings, ...patch } })));
jest.mock("@/components/app/privacy", () => {
  const { useStore } = jest.requireActual<typeof import("zustand")>("zustand");
  return {
    usePrivacySettings: () => useStore(mockPrivacy),
    deviceCanLock: () => mockCanLock(),
    authenticateOwner: (prompt: string, cancel: string) => mockAuthenticate(prompt, cancel),
    updatePrivacySettings: (patch: Partial<PrivacySettings>) => mockUpdate(patch),
  };
});

const lockSwitch = () => screen.getByLabelText(viText("mobile.security.app_lock"));
const securitySwitch = () => screen.getByLabelText(viText("mobile.security.screen_security"));

beforeEach(() => {
  jest.clearAllMocks();
  mockCanLock.mockResolvedValue(true);
  mockAuthenticate.mockResolvedValue(true);
  mockPrivacy.setState({ settings: DEFAULT_PRIVACY_SETTINGS, loaded: true, restored: true });
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});

describe("PrivacySection", () => {
  it("turns the lock on only after the owner proves it, and then offers when it locks again", async () => {
    await render(<PrivacySection />);
    expect(screen.getByRole("header", { name: viText("mobile.security.section") })).toBeOnTheScreen();
    expect(screen.queryByText(viText("mobile.security.app_lock_after"))).toBeNull();
    await act(() => fireEvent(lockSwitch(), "valueChange", true));
    expect(mockAuthenticate).toHaveBeenCalledWith(viText("mobile.security.unlock_prompt"), viText("common.cancel"));
    expect(mockUpdate).toHaveBeenCalledWith({ appLock: true });
    expect(screen.getByText(viText("mobile.security.app_lock_after"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("radio", { name: viText("mobile.security.app_lock_after_5m") }));
    expect(mockUpdate).toHaveBeenLastCalledWith({ relockAfterMs: 300_000 });
    expect(screen.getByRole("radio", { name: viText("mobile.security.app_lock_after_5m"), checked: true })).toBeOnTheScreen();
  });

  it("keeps the lock off when the proof is cancelled", async () => {
    mockAuthenticate.mockResolvedValueOnce(false);
    await render(<PrivacySection />);
    await act(() => fireEvent(lockSwitch(), "valueChange", true));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(lockSwitch()).toHaveProp("value", false);
  });

  it("says a phone with no screen lock cannot lock UniChat, and asks for nothing", async () => {
    mockCanLock.mockResolvedValueOnce(false);
    await render(<PrivacySection />);
    await act(() => fireEvent(lockSwitch(), "valueChange", true));
    expect(mockAuthenticate).not.toHaveBeenCalled();
    expect(screen.getByText(viText("mobile.security.app_lock_unavailable"))).toBeOnTheScreen();
  });

  it("turns the lock off only after the owner proves it, and screen security on and off at once", async () => {
    mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, appLock: true }, loaded: true, restored: true });
    mockAuthenticate.mockResolvedValueOnce(false);
    await render(<PrivacySection />);
    // Someone holding the unlocked phone cannot switch the lock off for later.
    await act(() => fireEvent(lockSwitch(), "valueChange", false));
    expect(mockAuthenticate).toHaveBeenCalledWith(viText("mobile.security.unlock_prompt"), viText("common.cancel"));
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(lockSwitch()).toHaveProp("value", true);
    await act(() => fireEvent(lockSwitch(), "valueChange", false));
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith({ appLock: false });
    await act(() => fireEvent(securitySwitch(), "valueChange", true));
    expect(mockUpdate).toHaveBeenLastCalledWith({ screenSecurity: true });
    expect(securitySwitch()).toHaveProp("value", true);
  });

  it("holds both switches until the saved choices are known, and puts a row of the caller's above them", async () => {
    mockPrivacy.setState({ settings: DEFAULT_PRIVACY_SETTINGS, loaded: false, restored: false });
    await render(
      <PrivacySection>
        <Text>row above</Text>
      </PrivacySection>,
    );
    expect(screen.getByText("row above")).toBeOnTheScreen();
    expect(lockSwitch()).toBeDisabled();
    expect(securitySwitch()).toBeDisabled();
  });
});

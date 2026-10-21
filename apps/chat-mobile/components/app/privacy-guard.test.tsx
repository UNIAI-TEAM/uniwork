// The privacy guard (privacy-guard.tsx): the cover away from the front, the app lock on a cold start and after the
// chosen time away, never over a call, and only for someone signed in.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { createStore } from "zustand/vanilla";
import { useAuthStore } from "@/data/auth/store";
import { callEngine } from "@/data/calls/call-store";
import type { PrivacyState } from "@/data/privacy-settings";
import { DEFAULT_PRIVACY_SETTINGS } from "@/lib/app-lock";
import { render, viText } from "@/test/render";
import { PrivacyGuard } from "./privacy-guard";

const mockPrivacy = createStore<PrivacyState>(() => ({ settings: DEFAULT_PRIVACY_SETTINGS, loaded: true }));
const mockAuthenticate = jest.fn(async (_prompt: string, _cancel: string) => true);
jest.mock("./privacy", () => {
  const { useStore } = jest.requireActual<typeof import("zustand")>("zustand");
  return {
    usePrivacySettings: () => useStore(mockPrivacy),
    authenticateOwner: (prompt: string, cancel: string) => mockAuthenticate(prompt, cancel),
  };
});

jest.mock("@/data/auth/store", () => {
  const { create } = jest.requireActual<typeof import("zustand")>("zustand");
  return { useAuthStore: create(() => ({ user: null as unknown })) };
});

let changeAppState: (status: AppStateStatus) => void = () => undefined;
let clock = 1_000;
const now = () => clock;

const setPrivacy = (state: Partial<PrivacyState["settings"]>, loaded = true) =>
  act(() => mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, ...state }, loaded }));
const goTo = (status: AppStateStatus) => act(() => changeAppState(status));

beforeEach(() => {
  jest.clearAllMocks();
  clock = 1_000;
  mockAuthenticate.mockResolvedValue(true);
  mockPrivacy.setState({ settings: DEFAULT_PRIVACY_SETTINGS, loaded: true });
  useAuthStore.setState({ user: { id: "u1", email: "an@acme.vn", display_name: "An" } as never });
  callEngine.store.setState({ call: { status: "idle" } });
  // React Native's Jest preset makes currentState a mock function; the app reads the string.
  Object.defineProperty(AppState, "currentState", { value: "active", configurable: true, writable: true });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    changeAppState = listener as (status: AppStateStatus) => void;
    return { remove: jest.fn() };
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("PrivacyGuard", () => {
  it("shows nothing with both protections off, in front or away", async () => {
    await render(<PrivacyGuard now={now} />);
    expect(screen.queryByTestId("privacy-cover")).toBeNull();
    await goTo("background");
    expect(screen.queryByTestId("privacy-cover")).toBeNull();
    expect(screen.queryByTestId("privacy-lock")).toBeNull();
  });

  it("covers the app away from the front with screen security on, so the app switcher shows no conversation", async () => {
    mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, screenSecurity: true }, loaded: true });
    await render(<PrivacyGuard now={now} />);
    expect(screen.queryByTestId("privacy-cover")).toBeNull();
    await goTo("inactive");
    expect(screen.getByTestId("privacy-cover")).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.security.privacy_cover"))).toBeOnTheScreen();
    await goTo("active");
    expect(screen.queryByTestId("privacy-cover")).toBeNull();
    // A Face ID prompt or the shade (inactive) never counts as time away: no lock with the lock off.
    expect(mockAuthenticate).not.toHaveBeenCalled();
  });

  it("covers the app until the saved choices are known, and never the sign-in screen", async () => {
    mockPrivacy.setState({ settings: DEFAULT_PRIVACY_SETTINGS, loaded: false });
    await render(<PrivacyGuard now={now} />);
    expect(screen.getByTestId("privacy-cover")).toBeOnTheScreen();
    await setPrivacy({});
    expect(screen.queryByTestId("privacy-cover")).toBeNull();

    await act(() => useAuthStore.setState({ user: null }));
    await setPrivacy({}, false);
    expect(screen.queryByTestId("privacy-cover")).toBeNull();
  });

  it("locks a cold start with the lock on, asks at once, and opens once the owner proves it", async () => {
    let answer: (ok: boolean) => void = () => undefined;
    mockAuthenticate.mockImplementationOnce(() => new Promise((resolve) => (answer = resolve)));
    mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, appLock: true }, loaded: true });
    await render(<PrivacyGuard now={now} />);
    expect(screen.getByTestId("privacy-lock")).toBeOnTheScreen();
    expect(screen.getByRole("header", { name: viText("mobile.security.locked_title") })).toBeOnTheScreen();
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(mockAuthenticate).toHaveBeenCalledWith(viText("mobile.security.unlock_prompt"), viText("common.cancel"));
    // A second tap while the prompt is up asks nothing more.
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.security.unlock") }));
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    await act(async () => answer(true));
    expect(screen.queryByTestId("privacy-lock")).toBeNull();
  });

  it("stays locked after a cancel, does not ask again by itself, and Unlock asks again", async () => {
    mockAuthenticate.mockResolvedValueOnce(false);
    mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, appLock: true }, loaded: true });
    await render(<PrivacyGuard now={now} />);
    // The cancelled prompt made the app inactive, then active again: no second prompt by itself.
    await goTo("inactive");
    await goTo("active");
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("privacy-lock")).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.security.unlock") }));
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("privacy-lock")).toBeNull();
  });

  it("locks again after the chosen time in the background, not before", async () => {
    mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, appLock: true, relockAfterMs: 60_000 }, loaded: true });
    await render(<PrivacyGuard now={now} />);
    expect(screen.queryByTestId("privacy-lock")).toBeNull();
    expect(mockAuthenticate).toHaveBeenCalledTimes(1);

    await goTo("background");
    expect(screen.getByTestId("privacy-cover")).toBeOnTheScreen();
    clock += 59_000;
    await goTo("active");
    expect(screen.queryByTestId("privacy-lock")).toBeNull();
    expect(screen.queryByTestId("privacy-cover")).toBeNull();

    await goTo("background");
    clock += 60_000;
    mockAuthenticate.mockResolvedValueOnce(false);
    await goTo("active");
    expect(screen.getByTestId("privacy-lock")).toBeOnTheScreen();
    expect(mockAuthenticate).toHaveBeenCalledTimes(2);

    // Away and back while still locked: asked again on the way back.
    await goTo("background");
    await goTo("active");
    expect(mockAuthenticate).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("privacy-lock")).toBeNull();
  });

  it("never holds a ringing or live call behind the lock, and locks again once it ends", async () => {
    mockAuthenticate.mockResolvedValue(false);
    callEngine.store.setState({ call: { status: "incoming", callId: "c1", roomId: "r1", peerName: "Bình", callKind: "dm" } });
    mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, appLock: true }, loaded: true });
    await render(<PrivacyGuard now={now} />);
    expect(screen.queryByTestId("privacy-lock")).toBeNull();
    expect(mockAuthenticate).not.toHaveBeenCalled();
    await act(() => callEngine.store.setState({ call: { status: "idle" } }));
    expect(screen.getByTestId("privacy-lock")).toBeOnTheScreen();
  });

  it("opens when the lock is turned off", async () => {
    mockAuthenticate.mockResolvedValue(false);
    mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, appLock: true }, loaded: true });
    await render(<PrivacyGuard now={now} />);
    expect(screen.getByTestId("privacy-lock")).toBeOnTheScreen();
    await setPrivacy({ appLock: false });
    expect(screen.queryByTestId("privacy-lock")).toBeNull();
  });

  it("uses the real clock by default", async () => {
    mockPrivacy.setState({ settings: { ...DEFAULT_PRIVACY_SETTINGS, appLock: true, relockAfterMs: 0 }, loaded: true });
    await render(<PrivacyGuard />);
    await goTo("background");
    mockAuthenticate.mockResolvedValueOnce(false);
    await goTo("active");
    expect(screen.getByTestId("privacy-lock")).toBeOnTheScreen();
  });
});

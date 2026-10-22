// Settings › notifications (push-section.tsx): the switch reads this phone's state, turning push off or on goes
// through the server first, a phone that cannot get a token is set back to off and says why, and a failure re-reads
// the real state and says so.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import { permissionGate } from "@/components/ui/permission-gate";
import { useSetPushEnabled } from "@/data/mutations/push";
import { isPushEnabled } from "@/data/push";
import { render, viText } from "@/test/render";
import { PushSection } from "./push-section";

jest.mock("@/data/push", () => ({ isPushEnabled: jest.fn(async () => true) }));
const mockSetPush = jest.fn<Promise<string | null>, [{ enabled: boolean; ask?: () => Promise<boolean> }]>();
jest.mock("@/data/mutations/push", () => ({ useSetPushEnabled: jest.fn(() => ({ mutateAsync: mockSetPush })) }));
// Its own test (full-screen-calls-row.test.tsx); here it would only read the native calls module.
jest.mock("./full-screen-calls-row", () => ({ FullScreenCallsRow: () => null }));

const enabled = jest.mocked(isPushEnabled);
const toggle = () => screen.getByLabelText(viText("mobile.settings.push_this_device"));
const flip = (next: boolean) => act(async () => fireEvent(toggle(), "valueChange", next));

beforeEach(() => {
  jest.clearAllMocks();
  enabled.mockResolvedValue(true);
  mockSetPush.mockResolvedValue("ExponentPushToken[x]");
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe("PushSection", () => {
  it("is held until this phone's state is read, then shows it", async () => {
    let answer: (value: boolean) => void = () => undefined;
    enabled.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    await render(<PushSection />);
    expect(toggle()).toHaveProp("disabled", true);
    await act(async () => answer(true));
    expect(toggle()).toHaveProp("value", true);
    expect(toggle()).toHaveProp("disabled", false);
    expect(jest.mocked(useSetPushEnabled)).toHaveBeenCalled();
  });

  it("turns push off through the server", async () => {
    await render(<PushSection />);
    await act(async () => undefined);
    await flip(false);
    expect(mockSetPush).toHaveBeenCalledWith({ enabled: false, ask: expect.any(Function) });
    expect(toggle()).toHaveProp("value", false);
    expect(screen.queryByText(viText("mobile.settings.push_unavailable"))).toBeNull();
  });

  it("turns it on, asking for the permission again through the gate", async () => {
    enabled.mockResolvedValue(false);
    const ensure = jest.spyOn(permissionGate, "ensure").mockResolvedValue(true);
    await render(<PushSection />);
    await act(async () => undefined);
    await flip(true);
    expect(toggle()).toHaveProp("value", true);
    await mockSetPush.mock.calls[0]?.[0].ask?.();
    expect(ensure).toHaveBeenCalledWith("notifications", "notifications");
  });

  it("sets a phone that got no token back to off and says push is unavailable", async () => {
    enabled.mockResolvedValue(false);
    mockSetPush.mockResolvedValueOnce(null);
    await render(<PushSection />);
    await act(async () => undefined);
    await flip(true);
    expect(mockSetPush).toHaveBeenLastCalledWith({ enabled: false });
    expect(toggle()).toHaveProp("value", false);
    expect(screen.getByText(viText("mobile.settings.push_unavailable"))).toBeOnTheScreen();
  });

  it("re-reads the real state after a failure and says it failed", async () => {
    await render(<PushSection />);
    await act(async () => undefined);
    mockSetPush.mockRejectedValueOnce(new Error("offline"));
    await flip(false);
    expect(enabled).toHaveBeenCalledTimes(2);
    expect(toggle()).toHaveProp("value", true);
    expect(screen.getByText(viText("mobile.settings.push_failed"))).toBeOnTheScreen();
  });

  it("drops a state read that lands after the screen closed", async () => {
    let answer: (value: boolean) => void = () => undefined;
    enabled.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)));
    const view = await render(<PushSection />);
    await view.unmount();
    // No state update on an unmounted screen (test/jest-setup.ts fails a test that logs an error).
    await act(async () => answer(true));
    expect(enabled).toHaveBeenCalledTimes(1);
  });
});

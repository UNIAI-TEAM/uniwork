import { act, fireEvent, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { nativeCalls } from "@/data/calls/native-calls";
import { render, viText } from "@/test/render";
import { FullScreenCallsRow } from "./full-screen-calls-row";

jest.mock("@/data/calls/native-calls", () => ({
  nativeCalls: { canUseFullScreenIntent: jest.fn(() => false), openFullScreenIntentSettings: jest.fn() },
}));

const canUse = jest.mocked(nativeCalls.canUseFullScreenIntent);
let onChange: (status: AppStateStatus) => void = () => undefined;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  canUse.mockReturnValue(false);
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    onChange = listener as (status: AppStateStatus) => void;
    return { remove };
  });
});

describe("FullScreenCallsRow", () => {
  it("says when Android took the full-screen ringing away and opens the page to give it back", async () => {
    await render(<FullScreenCallsRow />);
    expect(screen.getByText(viText("mobile.notify.full_screen_calls_hint"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.notify.full_screen_calls") }));
    expect(nativeCalls.openFullScreenIntentSettings).toHaveBeenCalledTimes(1);
  });

  it("goes away once it is given back, checked on the way back to the app", async () => {
    const view = await render(<FullScreenCallsRow />);
    canUse.mockReturnValue(true);
    await act(() => onChange("background"));
    expect(screen.getByRole("link", { name: viText("mobile.notify.full_screen_calls") })).toBeOnTheScreen();
    await act(() => onChange("active"));
    expect(screen.queryByRole("link", { name: viText("mobile.notify.full_screen_calls") })).toBeNull();
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("shows nothing where the permission is there (or not a thing)", async () => {
    canUse.mockReturnValue(true);
    await render(<FullScreenCallsRow />);
    expect(screen.toJSON()).toBeNull();
  });
});

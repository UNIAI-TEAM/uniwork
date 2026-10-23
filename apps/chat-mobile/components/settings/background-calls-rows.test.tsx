import { QueryClient } from "@tanstack/react-query";
import { act, fireEvent, screen } from "@testing-library/react-native";
import { AppState, type AppStateStatus } from "react-native";
import { nativeCalls } from "@/data/calls/native-calls";
import { REMOTE_CONFIG_FALLBACK, remoteConfigKey } from "@/data/remote-config";
import { render, viText } from "@/test/render";
import { BackgroundCallsRows } from "./background-calls-rows";

jest.mock("@/data/calls/native-calls", () => ({
  nativeCalls: {
    available: true,
    backgroundDelivery: jest.fn(),
    openBatterySettings: jest.fn(() => true),
    openAutostartSettings: jest.fn(() => true),
  },
}));

const delivery = jest.mocked(nativeCalls.backgroundDelivery);
const fine = { batteryOptimized: false, backgroundRestricted: false, autostartBrand: "", manufacturer: "Google" };
let onChange: (status: AppStateStatus) => void = () => undefined;
const remove = jest.fn();

beforeEach(() => {
  jest.clearAllMocks();
  (nativeCalls as { available: boolean }).available = true;
  delivery.mockReturnValue({ batteryOptimized: true, backgroundRestricted: false, autostartBrand: "xiaomi", manufacturer: "Xiaomi" });
  jest.spyOn(AppState, "addEventListener").mockImplementation((_, listener) => {
    onChange = listener as (status: AppStateStatus) => void;
    return { remove };
  });
});

describe("BackgroundCallsRows", () => {
  it("on a battery-limited Xiaomi, opens the battery page and the vendor's autostart screen, with the vendor's steps", async () => {
    await render(<BackgroundCallsRows />);
    expect(screen.getByText(viText("mobile.notify.background_battery_hint"))).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.notify.autostart_hint_xiaomi"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.notify.background_battery") }));
    expect(nativeCalls.openBatterySettings).toHaveBeenCalledTimes(1);
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.notify.background_autostart") }));
    expect(nativeCalls.openAutostartSettings).toHaveBeenCalledTimes(1);
  });

  it("reads Android again on the way back: the battery row goes once it is lifted, the autostart way stays", async () => {
    const view = await render(<BackgroundCallsRows />);
    delivery.mockReturnValue({ ...fine, autostartBrand: "xiaomi" });
    await act(() => onChange("background"));
    expect(screen.getByRole("link", { name: viText("mobile.notify.background_battery") })).toBeOnTheScreen();
    await act(() => onChange("active"));
    expect(screen.queryByRole("link", { name: viText("mobile.notify.background_battery") })).toBeNull();
    expect(screen.getByRole("link", { name: viText("mobile.notify.background_autostart") })).toBeOnTheScreen();
    await view.unmount();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("shows nothing on a phone with nothing in the way", async () => {
    delivery.mockReturnValue(fine);
    await render(<BackgroundCallsRows />);
    expect(screen.toJSON()).toBeNull();
  });

  it("shows nothing without the native module, or while the calls switch has calling off", async () => {
    (nativeCalls as { available: boolean }).available = false;
    const first = await render(<BackgroundCallsRows />);
    expect(screen.toJSON()).toBeNull();
    await first.unmount();
    (nativeCalls as { available: boolean }).available = true;
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    queryClient.setQueryData(remoteConfigKey, { ...REMOTE_CONFIG_FALLBACK, flags: { unichat_mobile_calls: false } });
    await render(<BackgroundCallsRows />, { queryClient });
    expect(screen.toJSON()).toBeNull();
  });
});

// Settings › devices (devices-section.tsx): every live sign-in, this phone marked and not revocable, the others
// revoked after a confirm, a failed revoke said, and a list that cannot be read said instead of shown empty.
import { act, fireEvent, screen } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { fetchDevices, revokeDevice, type Device } from "@/data/queries/devices";
import { toast } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import { DevicesSection } from "./devices-section";

jest.mock("@/data/queries/devices", () => {
  const actual = jest.requireActual<typeof import("@/data/queries/devices")>("@/data/queries/devices");
  const fetch = jest.fn();
  return { ...actual, fetchDevices: fetch, revokeDevice: jest.fn(async () => undefined), devicesOptions: () => ({ queryKey: actual.deviceKeys.all(), queryFn: () => fetch() }) };
});
// The mutation layer's query client reads NetInfo; its native module is not in Jest.
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = { configure: () => undefined, addEventListener: () => () => undefined, fetch: async () => ({ isConnected: true, isInternetReachable: true }) };
  return { __esModule: true, default: netInfo, ...netInfo, useNetInfo: () => ({ isConnected: true }) };
});
jest.mock("@/data/stores/toast-store", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

const devices = jest.mocked(fetchDevices);
const revoke = jest.mocked(revokeDevice);

const device = (over: Partial<Device>): Device => ({
  id: "d1",
  device_label: "",
  platform: "android",
  client_id: "uniwork-chat-mobile",
  last_used_at: "",
  expires_at: "2099-01-01T00:00:00Z",
  revoked_at: null,
  current: false,
  ...over,
});

/** The confirm's buttons, pressed as the person would. */
let buttons: AlertButton[] = [];

beforeEach(() => {
  jest.clearAllMocks();
  buttons = [];
  jest.spyOn(Alert, "alert").mockImplementation((_title, _body, given) => {
    buttons = given ?? [];
  });
});
afterEach(() => jest.restoreAllMocks());

const settle = () => act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

describe("DevicesSection", () => {
  it("lists this phone first, marked, and names the others with their platform", async () => {
    devices.mockResolvedValue([
      device({ id: "me", device_label: "Pixel 9", current: true }),
      device({ id: "mac", device_label: "  ", platform: "darwin" }),
      device({ id: "pc", device_label: "Laptop", platform: "freebsd" }),
    ]);
    await render(<DevicesSection />);
    expect(await screen.findByText("Pixel 9")).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.settings.this_device"))).toBeOnTheScreen();
    // A blank label reads as an unnamed device; an unknown platform keeps its own name.
    expect(screen.getByText(viText("mobile.settings.unnamed_device"))).toBeOnTheScreen();
    expect(screen.getByText("macOS")).toBeOnTheScreen();
    expect(screen.getByText("freebsd")).toBeOnTheScreen();
    // This phone cannot revoke itself (signing out does that).
    expect(screen.queryByRole("button", { name: `${viText("settings.security.sessions.revoke")} Pixel 9` })).toBeNull();
  });

  it("revokes another device only after the confirm", async () => {
    devices.mockResolvedValue([device({ id: "me", device_label: "Pixel 9", current: true }), device({ id: "ipad", device_label: "iPad", platform: "ios" })]);
    await render(<DevicesSection />);
    await fireEvent.press(await screen.findByRole("button", { name: `${viText("settings.security.sessions.revoke")} iPad` }));
    expect(Alert.alert).toHaveBeenCalledWith(viText("mobile.settings.revoke_title", { device: "iPad" }), viText("mobile.settings.revoke_body"), expect.any(Array));
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => buttons.find((b) => b.style === "destructive")?.onPress?.());
    await settle();
    expect(revoke).toHaveBeenCalledWith("ipad");
    expect(devices).toHaveBeenCalledTimes(2);
  });

  it("says when a revoke failed", async () => {
    devices.mockResolvedValue([device({ id: "ipad", device_label: "iPad", platform: "ios" })]);
    revoke.mockRejectedValueOnce(new Error("offline"));
    await render(<DevicesSection />);
    await fireEvent.press(await screen.findByRole("button", { name: `${viText("settings.security.sessions.revoke")} iPad` }));
    await act(async () => buttons.find((b) => b.style === "destructive")?.onPress?.());
    await settle();
    expect(toast.error).toHaveBeenCalledWith(viText("settings.security.sessions.revokeFailed"));
  });

  it("shows loading, then an error instead of an empty list when the devices cannot be read", async () => {
    let fail: (error: Error) => void = () => undefined;
    devices.mockReturnValue(new Promise<Device[]>((_resolve, reject) => (fail = reject)));
    await render(<DevicesSection />);
    expect(screen.getByLabelText(viText("common.loading"))).toBeOnTheScreen();
    await act(async () => fail(new Error("offline")));
    expect(await screen.findByText(viText("common.error"))).toBeOnTheScreen();
  });
});

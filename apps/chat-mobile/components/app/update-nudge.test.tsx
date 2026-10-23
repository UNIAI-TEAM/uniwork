import { fireEvent, screen } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { Platform } from "react-native";
import { render, viText } from "@/test/render";
import { UpdateNudge } from "./update-nudge";

const mockRemote = { data: undefined as unknown };
jest.mock("@/data/remote-config", () => ({ useRemoteConfig: () => mockRemote }));
jest.mock("@/data/build-info", () => ({ buildInfo: () => ({ version: "0.3.0" }) }));
jest.mock("expo-linking", () => ({ openURL: jest.fn(async () => true) }));
const mockDismissed = { value: null as string | null, read: jest.fn(), kept: [] as string[], failWrite: false };
jest.mock("@/data/release/update-nudge", () => ({
  readDismissedNudge: () => {
    mockDismissed.read();
    return mockDismissed.value === "throw" ? Promise.reject(new Error("store")) : Promise.resolve(mockDismissed.value);
  },
  dismissNudge: (version: string) => {
    if (mockDismissed.failWrite) return Promise.reject(new Error("store"));
    mockDismissed.kept.push(version);
    return Promise.resolve();
  },
}));

const STORES = { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" };
const config = (over: Record<string, unknown> = {}) => ({ minSupportedVersion: "", recommendedVersion: "0.3.2", flags: {}, storeUrl: STORES, ...over });
const title = () => viText("mobile.update.nudge_title", { version: "0.3.2" });

afterEach(() => {
  mockRemote.data = undefined;
  Object.assign(mockDismissed, { value: null, kept: [], failWrite: false });
  jest.clearAllMocks();
});

describe("UpdateNudge", () => {
  it("says a newer version is out and opens this platform's store", async () => {
    mockRemote.data = config();
    await render(<UpdateNudge />);
    const link = await screen.findByRole("link", { name: `${title()}, ${viText("mobile.update.nudge_body")}` });
    expect(screen.getByText(title())).toBeOnTheScreen();
    await fireEvent.press(link);
    expect(Linking.openURL).toHaveBeenCalledWith(Platform.OS === "ios" ? STORES.ios : STORES.android);
  });

  it.each(["ios", "android"] as const)("opens the %s store page", async (os) => {
    jest.replaceProperty(Platform, "OS", os);
    mockRemote.data = config();
    await render(<UpdateNudge />);
    await fireEvent.press(await screen.findByRole("link"));
    expect(Linking.openURL).toHaveBeenCalledWith(STORES[os]);
    jest.restoreAllMocks();
  });

  it("goes for good once dismissed, keeping that version, and a store that cannot keep it is only a breadcrumb", async () => {
    mockRemote.data = config();
    await render(<UpdateNudge />);
    await fireEvent.press(await screen.findByRole("button", { name: viText("mobile.update.nudge_dismiss") }));
    expect(screen.queryByTestId("update-nudge")).toBeNull();
    expect(mockDismissed.kept).toEqual(["0.3.2"]);
    mockDismissed.failWrite = true;
    await render(<UpdateNudge />);
    await fireEvent.press(await screen.findByRole("button", { name: viText("mobile.update.nudge_dismiss") }));
    expect(screen.queryByTestId("update-nudge")).toBeNull();
  });

  it("stays hidden for a dismissed version, without an answer, a recommendation or a store page, and until the store is read", async () => {
    mockDismissed.value = "0.3.2";
    mockRemote.data = config();
    await render(<UpdateNudge />);
    expect(mockDismissed.read).toHaveBeenCalled();
    expect(screen.queryByTestId("update-nudge")).toBeNull();
    mockDismissed.value = null;
    for (const data of [undefined, config({ recommendedVersion: "" }), config({ storeUrl: { ios: "", android: "" } }), config({ minSupportedVersion: "0.3.1" })]) {
      mockRemote.data = data;
      await render(<UpdateNudge />);
      expect(screen.queryByTestId("update-nudge")).toBeNull();
    }
    // A store that cannot be read shows nothing rather than a nudge someone may already have closed.
    mockDismissed.value = "throw";
    mockRemote.data = config();
    await render(<UpdateNudge />);
    expect(screen.queryByTestId("update-nudge")).toBeNull();
  });

  it("does not set state after it is gone", async () => {
    mockRemote.data = config();
    const { unmount } = await render(<UpdateNudge />);
    await unmount();
    expect(mockDismissed.read).toHaveBeenCalledTimes(1);
  });
});

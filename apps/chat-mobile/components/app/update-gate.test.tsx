import { fireEvent, screen } from "@testing-library/react-native";
import * as Linking from "expo-linking";
import { Platform, Text } from "react-native";
import { render, viText } from "@/test/render";
import { UpdateGate } from "./update-gate";

const mockRemote = { data: undefined as unknown, refetch: jest.fn(async () => ({})) };
jest.mock("@/data/remote-config", () => ({ useRemoteConfig: () => mockRemote }));
jest.mock("@/data/build-info", () => ({ buildInfo: () => ({ version: "0.2.0" }) }));
jest.mock("expo-linking", () => ({ openURL: jest.fn(async () => true) }));

const app = <Text>app</Text>;
const config = (minSupportedVersion: string, storeUrl = { ios: "https://apps.apple.com/app/id1", android: "https://play.google.com/store/apps/details?id=x" }) => ({
  minSupportedVersion,
  flags: {},
  storeUrl,
});

afterEach(() => {
  mockRemote.data = undefined;
  jest.clearAllMocks();
});

describe("UpdateGate", () => {
  it("lets the app through before the server answers, without a minimum, and at or above it", async () => {
    await render(<UpdateGate>{app}</UpdateGate>);
    expect(screen.getByText("app")).toBeOnTheScreen();
    mockRemote.data = config("");
    await render(<UpdateGate>{app}</UpdateGate>);
    expect(screen.getByText("app")).toBeOnTheScreen();
    mockRemote.data = config("0.2.0");
    await render(<UpdateGate>{app}</UpdateGate>);
    expect(screen.getByText("app")).toBeOnTheScreen();
  });

  it("replaces the app below the minimum, opens this platform's store and checks again", async () => {
    mockRemote.data = config("0.3.0");
    await render(<UpdateGate>{app}</UpdateGate>);
    expect(screen.queryByText("app")).toBeNull();
    expect(screen.getByRole("header", { name: viText("mobile.update.title") })).toBeOnTheScreen();
    expect(screen.getByText(viText("mobile.update.body", { version: "0.2.0", min: "0.3.0" }))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.update.open_store") }));
    expect(Linking.openURL).toHaveBeenCalledWith(Platform.OS === "ios" ? "https://apps.apple.com/app/id1" : "https://play.google.com/store/apps/details?id=x");
    await fireEvent.press(screen.getByRole("button", { name: viText("mobile.update.check_again") }));
    expect(mockRemote.refetch).toHaveBeenCalledTimes(1);
  });

  it.each(["ios", "android"] as const)("opens the %s store page", async (os) => {
    jest.replaceProperty(Platform, "OS", os);
    mockRemote.data = config("0.3.0");
    await render(<UpdateGate>{app}</UpdateGate>);
    await fireEvent.press(screen.getByRole("link", { name: viText("mobile.update.open_store") }));
    expect(Linking.openURL).toHaveBeenCalledWith(os === "ios" ? "https://apps.apple.com/app/id1" : "https://play.google.com/store/apps/details?id=x");
    jest.restoreAllMocks();
  });

  it("says whom to ask when no store has the new version", async () => {
    mockRemote.data = config("0.3.0", { ios: "", android: "" });
    await render(<UpdateGate>{app}</UpdateGate>);
    expect(screen.getByText(viText("mobile.update.no_store"))).toBeOnTheScreen();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

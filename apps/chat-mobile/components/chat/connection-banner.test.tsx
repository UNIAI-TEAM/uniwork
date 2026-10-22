import { act, screen } from "@testing-library/react-native";
import { render, viText } from "@/test/render";
import { ConnectionBanner, RECONNECT_GRACE_MS } from "./connection-banner";

const mockNet: { isConnected: boolean | null; isInternetReachable?: boolean | null } = { isConnected: true };
jest.mock("@react-native-community/netinfo", () => ({ useNetInfo: () => mockNet }));
const mockSocket: { state: string | null } = { state: "online" };
jest.mock("@/data/realtime/realtime-provider", () => ({ useConnectionState: () => mockSocket.state }));

beforeEach(() => {
  jest.useFakeTimers();
  mockNet.isConnected = true;
  mockNet.isInternetReachable = null;
  mockSocket.state = "online";
});
afterEach(() => jest.useRealTimers());

describe("ConnectionBanner", () => {
  it("shows nothing while the conversation is live, or outside a workspace", async () => {
    const { rerender } = await render(<ConnectionBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    mockSocket.state = null;
    await rerender(<ConnectionBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says it waits for the network while the phone has none", async () => {
    mockNet.isConnected = false;
    mockSocket.state = "waiting";
    await render(<ConnectionBanner />);
    expect(screen.getByRole("alert")).toHaveTextContent(viText("chat.mobile.offline_banner"), { exact: false });
    expect(screen.getByTestId("connection-banner-offline")).toBeTruthy();
  });

  it("says it waits for the network behind a captive portal or dead Wi-Fi: a link that does not reach the internet", async () => {
    mockNet.isInternetReachable = false;
    mockSocket.state = "waiting";
    await render(<ConnectionBanner />);
    expect(screen.getByTestId("connection-banner-offline")).toBeTruthy();
  });

  it("says Connecting… once the socket has been down past the grace, and goes when it is back", async () => {
    mockSocket.state = "connecting";
    const { rerender } = await render(<ConnectionBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
    await act(async () => jest.advanceTimersByTime(RECONNECT_GRACE_MS));
    expect(screen.getByRole("alert")).toHaveTextContent(viText("chat.mobile.connecting_banner"), { exact: false });
    expect(screen.getByTestId("connection-banner-connecting")).toBeTruthy();
    mockSocket.state = "waiting";
    await rerender(<ConnectionBanner />);
    await act(async () => jest.advanceTimersByTime(RECONNECT_GRACE_MS));
    expect(screen.getByRole("alert")).toHaveTextContent(viText("chat.mobile.connecting_banner"), { exact: false });
    mockSocket.state = "online";
    await rerender(<ConnectionBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("a blip shorter than the grace never shows", async () => {
    mockSocket.state = "waiting";
    const { rerender, unmount } = await render(<ConnectionBanner />);
    await act(async () => jest.advanceTimersByTime(RECONNECT_GRACE_MS - 1));
    mockSocket.state = "online";
    await rerender(<ConnectionBanner />);
    await act(async () => jest.advanceTimersByTime(RECONNECT_GRACE_MS));
    expect(screen.queryByRole("alert")).toBeNull();
    await unmount();
  });
});

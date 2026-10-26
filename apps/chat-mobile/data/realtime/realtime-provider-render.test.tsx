// The workspace socket's owner (realtime-provider.tsx), on a fake socket (test/fake-ws-client.ts): one socket per
// signed-in workspace, torn down when either goes; its state for the banner; a session the server ended refreshed
// and redialled; the network's offline → online edge redialling; a short trip to the background probing, a long one
// pausing, and a call holding the socket open until it ends.
import { act, render, screen } from "@testing-library/react-native";
import { AppState, Text, type AppStateStatus } from "react-native";
import { FakeWSClient } from "@/test/fake-ws-client";
import { RealtimeProvider, useConnectionState, useWSClient } from "./realtime-provider";

jest.mock("@/data/realtime/ws-client", () => ({ WSClient: jest.requireActual("@/test/fake-ws-client").FakeWSClient }));

type NetListener = (state: { isConnected: boolean | null; isInternetReachable?: boolean | null }) => void;
let mockNetListener: NetListener = () => undefined;
const mockNetUnsubscribe = jest.fn();
jest.mock("@react-native-community/netinfo", () => {
  const netInfo = {
    addEventListener: (listener: NetListener) => {
      mockNetListener = listener;
      return mockNetUnsubscribe;
    },
    fetch: async () => ({ isConnected: true, isInternetReachable: true }),
  };
  return { __esModule: true, default: netInfo, ...netInfo };
});

let appStateChange: (status: AppStateStatus) => void = () => undefined;
const removeAppState = jest.fn();

function Probe() {
  const client = useWSClient();
  const state = useConnectionState();
  return <Text testID="probe">{`${client ? "client" : "none"}:${state ?? "null"}`}</Text>;
}

interface Props {
  userId?: string | null;
  workspaceSlug?: string | null;
  holdOpen?: boolean;
  refreshSession?: () => Promise<string | null>;
}

// holdOpen left out unless a test sets it: the provider's default is "no call".
const tree = ({ userId = "ME", workspaceSlug = "acme/hq", holdOpen, refreshSession = async () => "token-2" }: Props = {}) => (
  <RealtimeProvider userId={userId} workspaceSlug={workspaceSlug} getToken={() => "token-1"} refreshSession={refreshSession} {...(holdOpen === undefined ? {} : { holdOpen })}>
    <Probe />
  </RealtimeProvider>
);

const probe = () => screen.getByTestId("probe").props.children as string;
const setAppState = (status: AppStateStatus) => Object.defineProperty(AppState, "currentState", { value: status, configurable: true, writable: true });

beforeEach(() => {
  jest.clearAllMocks();
  FakeWSClient.reset();
  setAppState("active");
  jest.spyOn(AppState, "addEventListener").mockImplementation((_event, listener) => {
    appStateChange = listener as (status: AppStateStatus) => void;
    return { remove: removeAppState };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("RealtimeProvider", () => {
  it("opens one socket for the signed-in workspace and exposes it and its state", async () => {
    await render(tree());
    const ws = FakeWSClient.latest();
    expect(FakeWSClient.instances).toHaveLength(1);
    expect(ws.calls).toEqual(["connect"]);
    expect(ws.opts.workspaceSlug).toBe("acme/hq");
    expect(ws.opts.url).toMatch(/\/api\/v1\/ws$/);
    expect(await ws.opts.getToken()).toBe("token-1");
    expect(probe()).toBe("client:null");
    await act(async () => ws.emitState("online"));
    expect(probe()).toBe("client:online");
    await act(async () => ws.emitState("waiting"));
    expect(probe()).toBe("client:waiting");
  });

  it("has no socket signed out or outside a workspace, and closes the one it had", async () => {
    const view = await render(tree({ userId: null }));
    expect(FakeWSClient.instances).toHaveLength(0);
    expect(probe()).toBe("none:null");
    await view.rerender(tree());
    const ws = FakeWSClient.latest();
    await view.rerender(tree({ workspaceSlug: null }));
    expect(ws.calls.at(-1)).toBe("disconnect");
    expect(ws.listenerCount()).toBe(0);
    expect(removeAppState).toHaveBeenCalledTimes(1);
    expect(mockNetUnsubscribe).toHaveBeenCalledTimes(1);
    expect(probe()).toBe("none:null");
  });

  it("dials a fresh socket for another workspace", async () => {
    const view = await render(tree());
    await view.rerender(tree({ workspaceSlug: "acme/sales" }));
    expect(FakeWSClient.instances.map((ws) => ws.opts.workspaceSlug)).toEqual(["acme/hq", "acme/sales"]);
    expect(FakeWSClient.instances[0]?.calls.at(-1)).toBe("disconnect");
  });

  it("refreshes a session the server ended and redials with it, or closes when signed out", async () => {
    const refresh = jest.fn<Promise<string | null>, []>().mockResolvedValueOnce("token-2").mockResolvedValueOnce(null);
    await render(tree({ refreshSession: refresh }));
    const ws = FakeWSClient.latest();
    await act(async () => ws.endSession());
    expect(ws.calls.at(-1)).toBe("forceReconnect");
    await act(async () => ws.endSession("invalid token"));
    expect(ws.calls.at(-1)).toBe("disconnect");
    expect(refresh).toHaveBeenCalledTimes(2);
    // A refusal that is not about the session (not a member) waits for the next foreground return or network edge.
    await act(async () => ws.endSession("not a member"));
    expect(ws.calls.at(-1)).toBe("disconnect");
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("redials on the network's offline → online edge only", async () => {
    await render(tree());
    const ws = FakeWSClient.latest();
    await act(async () => mockNetListener({ isConnected: true }));
    await act(async () => mockNetListener({ isConnected: true }));
    expect(ws.calls).not.toContain("forceReconnect");
    await act(async () => mockNetListener({ isConnected: false }));
    await act(async () => mockNetListener({ isConnected: null }));
    await act(async () => mockNetListener({ isConnected: true }));
    expect(ws.calls.filter((call) => call === "forceReconnect")).toHaveLength(1);
    // Out of a captive portal: the link never dropped, the internet came back.
    await act(async () => mockNetListener({ isConnected: true, isInternetReachable: false }));
    await act(async () => mockNetListener({ isConnected: true, isInternetReachable: true }));
    expect(ws.calls.filter((call) => call === "forceReconnect")).toHaveLength(2);
  });

  it("probes after a short trip to the background and pauses after a long one", async () => {
    jest.useFakeTimers();
    await render(tree());
    const ws = FakeWSClient.latest();
    await act(async () => ws.emitState("online"));
    await act(async () => appStateChange("background"));
    await act(async () => jest.advanceTimersByTime(5_000));
    await act(async () => appStateChange("active"));
    expect(ws.calls.at(-1)).toBe("probe");
    await act(async () => appStateChange("background"));
    await act(async () => jest.advanceTimersByTime(30_000));
    expect(ws.calls.at(-1)).toBe("pause");
  });

  it("keeps the socket open in the background while a call holds it, and pauses once the call ends", async () => {
    jest.useFakeTimers();
    const view = await render(tree({ holdOpen: true }));
    const ws = FakeWSClient.latest();
    setAppState("background");
    await act(async () => appStateChange("background"));
    await act(async () => jest.advanceTimersByTime(60_000));
    expect(ws.calls).not.toContain("pause");
    await view.rerender(tree({ holdOpen: false }));
    expect(ws.calls.at(-1)).toBe("pause");
  });

  it("does not pause a socket in front when a call ends", async () => {
    const view = await render(tree({ holdOpen: true }));
    await view.rerender(tree({ holdOpen: false }));
    expect(FakeWSClient.latest().calls).not.toContain("pause");
  });
});

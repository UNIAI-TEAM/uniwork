// @vitest-environment node
// Ported from usf apps/mobile/data/realtime/realtime-provider.test.ts
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const lifecycle = vi.hoisted(() => ({
  setup: undefined as (() => () => void) | undefined,
  onAppState: undefined as ((state: string) => void) | undefined,
  onNetInfo: undefined as ((state: { isConnected: boolean | null }) => void) | undefined,
}));

vi.mock("react", async (importOriginal) => ({
  ...await importOriginal<typeof import("react")>(),
  useEffect: (setup: () => () => void) => { lifecycle.setup = setup; },
  useRef: (current: unknown) => ({ current }),
  useState: () => [null, vi.fn()],
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  AppState: {
    addEventListener: (_event: string, handler: (state: string) => void) => {
      lifecycle.onAppState = handler;
      return { remove: vi.fn() };
    },
  },
}));
vi.mock("@react-native-community/netinfo", () => ({
  default: {
    addEventListener: (handler: (state: { isConnected: boolean | null }) => void) => {
      lifecycle.onNetInfo = handler;
      return vi.fn();
    },
  },
}));

// Run the provider's effect and its actual WSClient, without rendering RN.
class MockWebSocket {
  static readonly OPEN = 1;
  static instances: MockWebSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event?: { code?: number }) => void) | null = null;
  readonly sent: string[] = [];
  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }
  authenticate() {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
    this.onmessage?.({ data: JSON.stringify({ type: "auth_ack" }) });
  }
  send(frame: string) {
    this.sent.push(frame);
  }
  close() {}
}

const latest = () => MockWebSocket.instances[MockWebSocket.instances.length - 1]!;
const flush = async () => {
  for (let i = 0; i < 4; i++) await Promise.resolve();
};

async function mount(overrides: { refreshSession?: () => Promise<string | null>; userId?: string | null } = {}) {
  const { RealtimeProvider } = await import("./realtime-provider");
  let token = "token-v1";
  const refreshSession = overrides.refreshSession ?? vi.fn(async () => (token = "token-v2"));
  RealtimeProvider({
    userId: "userId" in overrides ? overrides.userId! : "user-1",
    workspaceSlug: "org/ws",
    getToken: () => token,
    refreshSession,
    children: null,
  });
  const cleanup = lifecycle.setup!();
  return { cleanup, refreshSession };
}

describe("RealtimeProvider", () => {
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    lifecycle.setup = undefined;
    lifecycle.onAppState = undefined;
    lifecycle.onNetInfo = undefined;
    MockWebSocket.instances = [];
    vi.stubGlobal("WebSocket", MockWebSocket);
    configureRuntime({ wsUrl: "wss://example.test" });
    vi.spyOn(console, "info").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    resetRuntimeConfig();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("dials runtimeConfig().wsUrl with the workspace pair and the device OS", async () => {
    ({ cleanup } = await mount());
    const url = new URL(latest().url);
    expect(url.origin + url.pathname).toBe("wss://example.test/api/v1/ws");
    expect(url.searchParams.get("workspace_slug")).toBe("org/ws");
    expect(url.searchParams.get("client_os")).toBe("android");
    expect(url.searchParams.get("client_platform")).toBe("mobile");
  });

  it("opens one socket per background return; an inactive blip keeps an authenticated socket", async () => {
    ({ cleanup } = await mount());
    expect(MockWebSocket.instances).toHaveLength(1);

    lifecycle.onAppState!("background");
    expect(MockWebSocket.instances).toHaveLength(1);
    lifecycle.onAppState!("active");
    expect(MockWebSocket.instances).toHaveLength(2);

    // Control Center / app switcher: the socket is healthy, so it stays.
    latest().authenticate();
    lifecycle.onAppState!("inactive");
    lifecycle.onAppState!("active");
    expect(MockWebSocket.instances).toHaveLength(2);

    // The same blip over a socket that never authenticated redials.
    latest().readyState = 0;
    lifecycle.onAppState!("inactive");
    lifecycle.onAppState!("active");
    expect(MockWebSocket.instances).toHaveLength(3);
  });

  it("force-reconnects only on the offline → online edge", async () => {
    ({ cleanup } = await mount());
    lifecycle.onNetInfo!({ isConnected: true });
    lifecycle.onNetInfo!({ isConnected: null });
    expect(MockWebSocket.instances).toHaveLength(1);
    lifecycle.onNetInfo!({ isConnected: false });
    lifecycle.onNetInfo!({ isConnected: true });
    expect(MockWebSocket.instances).toHaveLength(2);
    lifecycle.onNetInfo!({ isConnected: true });
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("4001 → refreshSession once → forceReconnect once with the new token", async () => {
    const mounted = await mount();
    cleanup = mounted.cleanup;
    latest().authenticate();
    latest().onclose!({ code: 4001 });
    expect(mounted.refreshSession).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(1);

    await flush();
    expect(MockWebSocket.instances).toHaveLength(2);
    latest().authenticate();
    expect(JSON.parse(latest().sent[0]!)).toEqual({ type: "auth", payload: { token: "token-v2" } });
    expect(mounted.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("a pre-auth refusal that is not a token problem leaves the socket down until the next foreground return", async () => {
    const mounted = await mount();
    cleanup = mounted.cleanup;
    latest().onopen?.();
    latest().onmessage?.({ data: JSON.stringify({ error: "not a member of this workspace" }) });
    await flush();
    expect(mounted.refreshSession).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[realtime] socket refused"), "not a member of this workspace");
    lifecycle.onAppState!("background");
    lifecycle.onAppState!("active");
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("a pre-auth invalid-token refusal goes through the refresh path", async () => {
    const mounted = await mount();
    cleanup = mounted.cleanup;
    latest().onopen?.();
    latest().onmessage?.({ data: JSON.stringify({ error: "invalid token" }) });
    await flush();
    expect(mounted.refreshSession).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("a refresh that yields no session (signed out) disconnects instead of redialling", async () => {
    ({ cleanup } = await mount({ refreshSession: async () => null }));
    latest().authenticate();
    latest().onclose!({ code: 4001 });
    await flush();
    expect(MockWebSocket.instances).toHaveLength(1);
    // Disconnected: a later foreground return no longer redials.
    lifecycle.onAppState!("active");
    expect(MockWebSocket.instances).toHaveLength(1);
  });

  it("a refresh that fails leaves recovery to the next foreground return", async () => {
    ({ cleanup } = await mount({ refreshSession: () => Promise.reject(new Error("offline")) }));
    latest().authenticate();
    latest().onclose!({ code: 4001 });
    await flush();
    expect(MockWebSocket.instances).toHaveLength(1);
    expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("[realtime] refresh failed"), expect.any(Error));
    lifecycle.onAppState!("active");
    expect(MockWebSocket.instances).toHaveLength(2);
  });

  it("opens nothing without a signed-in user", async () => {
    ({ cleanup } = await mount({ userId: null }));
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(lifecycle.onAppState).toBeUndefined();
  });
});

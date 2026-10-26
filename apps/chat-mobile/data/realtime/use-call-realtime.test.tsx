// The calls hook on a real call engine (data/calls/call-engine.ts) with fake
// signalling: what the server's kill switch (data/remote-config.ts) may and
// may not do to a call. Rendered by the jest-expo layer (jest.config.js): a
// hook's effect dependencies are the bug class here, and only React runs them.
import { act } from "@testing-library/react-native";
import { AppState } from "react-native";
import type { WSClient } from "@/data/realtime/ws-client";
import { render } from "@/test/render";
import { useCallRealtime } from "./use-call-realtime";

const mockFlag = { calls: true };
jest.mock("@/data/remote-config", () => ({ useMobileFlag: () => mockFlag.calls }));
const mockAuth: { user: { id: string } | null } = { user: { id: "me" } };
jest.mock("@/data/auth/store", () => ({ useAuthStore: (select: (s: typeof mockAuth) => unknown) => select(mockAuth) }));
const mockRooms = { load: async (): Promise<{ id: string }[]> => [{ id: "room-1" }] };
jest.mock("@/data/queries/chat", () => ({
  roomsOptions: (wsId: string) => ({ queryKey: ["rooms", wsId], queryFn: () => mockRooms.load() }),
}));

type Handler = (payload: unknown) => void;
const mockSocket = { handlers: new Map<string, Handler>(), reconnect: [] as (() => void)[] };
jest.mock("@/data/realtime/use-ws-subscriptions", () => {
  const { useEffect } = jest.requireActual<typeof import("react")>("react");
  return {
    useWSSubscriptions: (setup: (ws: WSClient) => (() => void)[]) => {
      useEffect(() => {
        const ws = {
          on: (event: string, handler: Handler) => {
            mockSocket.handlers.set(event, handler);
            return () => mockSocket.handlers.delete(event);
          },
          onReconnect: (handler: () => void) => {
            mockSocket.reconnect.push(handler);
            return () => undefined;
          },
        } as unknown as WSClient;
        const unsubs = setup(ws);
        return () => unsubs.forEach((u) => u());
        // Subscribed once per mount, as the real hook does with empty deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, []);
    },
  };
});

const mockSignals = {
  invite: jest.fn(async () => true),
  accept: jest.fn(async () => true),
  hangup: jest.fn(async () => true),
  pending: jest.fn(async () => []),
  outgoing: jest.fn(async () => []),
  mintToken: jest.fn(async () => ({ token: "t", url: "wss://lk.test" })),
  createCallId: () => "call-1",
};
const mockHangupListeners = new Set<(wsId: string) => void>();
// jest.mock factories run before this file's consts: the engine reads the fakes at call time.
jest.mock("@/data/calls/call-store", () => {
  const { createCallEngine } = jest.requireActual<typeof import("@/data/calls/call-engine")>("@/data/calls/call-engine");
  return {
    // As call-store.ts: a settled hangup tells every listener which workspace it was in.
    onHangupSettled: (listener: (wsId: string) => void) => {
      mockHangupListeners.add(listener);
      return () => mockHangupListeners.delete(listener);
    },
    callEngine: createCallEngine({
      invite: () => mockSignals.invite(),
      accept: () => mockSignals.accept(),
      hangup: (wsId: string) => mockSignals.hangup().finally(() => mockHangupListeners.forEach((listener) => listener(wsId))),
      pending: () => mockSignals.pending(),
      outgoing: () => mockSignals.outgoing(),
      mintToken: () => mockSignals.mintToken(),
      createCallId: () => mockSignals.createCallId(),
    }),
  };
});

import { callEngine } from "@/data/calls/call-store";

function Probe({ wsId }: { wsId: string }) {
  useCallRealtime(wsId);
  return null;
}

// React Native's Jest preset hands back no subscription from AppState: one the hook can remove.
let appStateSpy: jest.SpyInstance;
beforeEach(() => {
  appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(() => ({ remove: jest.fn() }) as never);
});
afterEach(() => appStateSpy.mockRestore());

beforeEach(() => {
  mockFlag.calls = true;
  mockAuth.user = { id: "me" };
  mockSocket.handlers.clear();
  mockSocket.reconnect = [];
  jest.clearAllMocks();
});

// Each test leaves the engine idle or on its "ended" panel, which this clears (and its clock).
afterEach(() => callEngine.dismissEnded());

describe("useCallRealtime and the calls kill switch", () => {
  it("turning the switch off keeps an ongoing call connected and sends no hang-up", async () => {
    const { rerender } = await render(<Probe wsId="ws-1" />);
    await act(async () => {
      await callEngine.startCall("room-1", "Lan", "dm");
    });
    await act(async () => mockSocket.handlers.get("chat.voice.accept")?.({ room_id: "room-1", call_id: "call-1", user_id: "peer", target_user_id: "me" }));
    expect(callEngine.store.getState().call.status).toBe("active");

    mockFlag.calls = false;
    await rerender(<Probe wsId="ws-1" />);

    expect(callEngine.store.getState().call).toMatchObject({ status: "active", callId: "call-1" });
    expect(mockSignals.hangup).not.toHaveBeenCalled();
    // The call still hears its end from the peer.
    await act(async () => mockSocket.handlers.get("chat.voice.hangup")?.({ room_id: "room-1", call_id: "call-1", user_id: "peer", target_user_id: "me" }));
    expect(callEngine.store.getState().call.status).not.toBe("active");
  });

  it("with the switch off nothing rings and no invite is asked for; turning it on asks once", async () => {
    mockFlag.calls = false;
    const { rerender } = await render(<Probe wsId="ws-1" />);
    expect(mockSignals.pending).not.toHaveBeenCalled();
    await act(async () => mockSocket.handlers.get("chat.voice.invite")?.({ room_id: "room-1", call_id: "call-2", caller_id: "peer", caller_name: "Lan", call_kind: "dm", target_user_id: "me" }));
    await act(async () => mockSocket.reconnect.forEach((handler) => handler()));
    expect(callEngine.store.getState().call.status).toBe("idle");
    expect(mockSignals.pending).not.toHaveBeenCalled();

    mockFlag.calls = true;
    await rerender(<Probe wsId="ws-1" />);
    expect(mockSignals.pending).toHaveBeenCalledTimes(1);
    await act(async () => mockSocket.reconnect.forEach((handler) => handler()));
    expect(mockSignals.pending).toHaveBeenCalledTimes(2);
    await act(async () => mockSocket.handlers.get("chat.voice.invite")?.({ room_id: "room-1", call_id: "call-3", caller_id: "peer", caller_name: "Lan", call_kind: "dm", target_user_id: "me" }));
    expect(callEngine.store.getState().call).toMatchObject({ status: "incoming", callId: "call-3" });
    await act(async () => {
      await callEngine.hangUp();
    });
    expect(callEngine.store.getState().call.status).toBe("idle");
  });

  it("a group call rings nothing before the workspace's rooms have loaded (no room is known to be this person's yet)", async () => {
    const load = mockRooms.load;
    mockRooms.load = () => new Promise(() => undefined);
    try {
      await render(<Probe wsId="ws-1" />);
      await act(async () => mockSocket.handlers.get("chat.voice.invite")?.({ room_id: "room-1", call_id: "call-5", caller_id: "peer", caller_name: "Lan", call_kind: "group" }));
      expect(callEngine.store.getState().call.status).toBe("idle");
    } finally {
      mockRooms.load = load;
    }
  });

  it("signed out, the workspace attaches nothing and asks for nothing", async () => {
    mockAuth.user = null;
    await render(<Probe wsId="ws-1" />);
    await act(async () => {
      expect(await callEngine.startCall("room-1", "Lan", "dm")).toBe(false);
    });
    expect(mockSignals.pending).not.toHaveBeenCalled();
  });

  it("a return from the background reconciles with the server: a ring it no longer lists stops (audit C1)", async () => {
    const listeners: ((status: string) => void)[] = [];
    const remove = jest.fn();
    appStateSpy.mockImplementation((_event, handler) => {
      listeners.push(handler as (status: string) => void);
      return { remove } as never;
    });
    const { unmount } = await render(<Probe wsId="ws-1" />);
    await act(async () => mockSocket.handlers.get("chat.voice.invite")?.({ room_id: "room-1", call_id: "call-4", caller_id: "peer", caller_name: "Lan", call_kind: "dm", target_user_id: "me" }));
    expect(callEngine.store.getState().call).toMatchObject({ status: "incoming", callId: "call-4" });
    mockSignals.pending.mockClear();
    // An inactive blip is not a return from the background.
    await act(async () => listeners.forEach((l) => l("inactive")));
    await act(async () => listeners.forEach((l) => l("active")));
    expect(mockSignals.pending).not.toHaveBeenCalled();
    await act(async () => listeners.forEach((l) => l("background")));
    await act(async () => listeners.forEach((l) => l("active")));
    expect(mockSignals.pending).toHaveBeenCalledTimes(1);
    expect(callEngine.store.getState().call).toMatchObject({ status: "ended", reason: "missed" });
    await act(async () => unmount());
    expect(remove).toHaveBeenCalled();
  });

  it("refetches the calls tab once a hangup this phone sent has settled, and stops listening on unmount", async () => {
    const { queryClient, unmount } = await render(<Probe wsId="ws-1" />);
    const invalidate = jest.spyOn(queryClient, "invalidateQueries");
    await act(async () => {
      await callEngine.startCall("room-1", "Lan", "dm");
    });
    await act(async () => {
      await callEngine.hangUp();
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ["chat", "ws-1", "call-logs"] });
    await act(async () => unmount());
    expect(mockHangupListeners.size).toBe(0);
  });

  it("closing the workspace (the last one open) still ends the call here", async () => {
    const { unmount } = await render(<Probe wsId="ws-1" />);
    await act(async () => {
      await callEngine.startCall("room-1", "Lan", "dm");
    });
    expect(callEngine.store.getState().call.status).toBe("ringing");
    await act(async () => unmount());
    expect(callEngine.store.getState().call.status).toBe("idle");
  });
});

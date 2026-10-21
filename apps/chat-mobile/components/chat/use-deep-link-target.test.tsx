// The Chat tab's deep links (use-deep-link-target.ts): each link is carried
// out once, its params are cleared, and a call's push rings, answers after the
// microphone primer, or opens the room when the call is over or calls are off.
import { act } from "@testing-library/react-native";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import type { ChatWorkspace } from "./use-chat-workspace";
import { useDeepLinkTarget } from "./use-deep-link-target";

// jest.mock factories run before this file's consts (the imports above are hoisted): each fake is
// made inside its factory, or read through a function at call time, and reached with jest.requireMock.
const mockParams: { current: Record<string, string | undefined> } = { current: {} };
jest.mock("expo-router", () => ({ router: { push: jest.fn(), setParams: jest.fn() }, useLocalSearchParams: () => mockParams.current }));
jest.mock("@/data/calls/call-store", () => ({ callEngine: { ringFromPush: jest.fn(async () => true), joinFromPush: jest.fn(async () => true) } }));
jest.mock("@/data/calls/native-calls", () => ({ nativeCalls: { cancelIncomingCall: jest.fn() } }));
const mockFlags = { calls: true };
jest.mock("@/data/remote-config", () => ({ readMobileFlag: () => mockFlags.calls }));
const mockResolveDM = jest.fn(async (_userId: string): Promise<{ id: string } | null> => ({ id: "dm-1" }));
jest.mock("@/data/mutations/rooms", () => ({ useResolveDM: () => ({ mutateAsync: (userId: string) => mockResolveDM(userId) }) }));

const mockRouter = jest.requireMock<{ router: { push: jest.Mock; setParams: jest.Mock } }>("expo-router").router;
const mockCalls = jest.requireMock<{ callEngine: { ringFromPush: jest.Mock; joinFromPush: jest.Mock } }>("@/data/calls/call-store").callEngine;
const mockNative = jest.requireMock<{ nativeCalls: { cancelIncomingCall: jest.Mock } }>("@/data/calls/native-calls").nativeCalls;

const chat: ChatWorkspace = { wsId: "w1", orgSlug: "acme", wsSlug: "main", workspaceName: "Main", userId: "me" };

function Probe({ chat: workspace }: { chat: ChatWorkspace | null }) {
  useDeepLinkTarget(workspace);
  return null;
}

const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

beforeEach(() => {
  jest.clearAllMocks();
  mockFlags.calls = true;
  mockParams.current = {};
  useToastStore.setState({ toasts: [] });
});

async function land(params: Record<string, string | undefined>, workspace: ChatWorkspace | null = chat) {
  mockParams.current = params;
  const view = await render(<Probe chat={workspace} />);
  await act(async () => undefined);
  return view;
}

describe("useDeepLinkTarget", () => {
  it("opens a room at a message once, and clears the link's params", async () => {
    const view = await land({ room: "r1", message: "m1" });
    expect(mockRouter.setParams).toHaveBeenCalledWith({ room: undefined, message: undefined, dm: undefined, call: undefined, answer: undefined });
    expect(mockRouter.push.mock.calls).toEqual([["/acme/main/room/r1?message=m1"]]);
    // The same link seen again (a re-render before the params clear) is not carried out twice.
    await view.rerender(<Probe chat={{ ...chat }} />);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
  });

  it("waits for the workspace, and takes the same link again after the params cleared", async () => {
    const view = await land({ room: "r1" }, null);
    expect(mockRouter.push).not.toHaveBeenCalled();
    await view.rerender(<Probe chat={chat} />);
    expect(mockRouter.push).toHaveBeenCalledTimes(1);
    mockParams.current = {};
    await view.rerender(<Probe chat={{ ...chat }} />);
    mockParams.current = { room: "r1" };
    await view.rerender(<Probe chat={{ ...chat }} />);
    expect(mockRouter.push).toHaveBeenCalledTimes(2);
  });

  it("opens the DM with a person, or says it could not", async () => {
    await land({ dm: "u2" });
    expect(mockResolveDM).toHaveBeenCalledWith("u2");
    expect(mockRouter.push).toHaveBeenCalledWith("/acme/main/room/dm-1");

    // No room back, and a failed request: each says the DM could not open (the toast store shows one copy at a time).
    mockResolveDM.mockResolvedValueOnce(null);
    await land({ dm: "u3" });
    expect(toasts()).toEqual([viText("chat.dm_failed")]);
    useToastStore.setState({ toasts: [] });
    mockResolveDM.mockRejectedValueOnce(new Error("offline"));
    await land({ dm: "u4" });
    expect(toasts()).toEqual([viText("chat.dm_failed")]);
  });

  it("rings for a call's push, and opens the room when the call is already over", async () => {
    await land({ room: "r1", call: "c1" });
    expect(mockCalls.ringFromPush).toHaveBeenCalledWith("r1", "c1");
    expect(mockRouter.push).not.toHaveBeenCalled();

    mockCalls.ringFromPush.mockResolvedValueOnce(false);
    await land({ room: "r2", call: "c2" });
    expect(mockNative.cancelIncomingCall).toHaveBeenCalledWith("c2");
    expect(mockRouter.push).toHaveBeenCalledWith("/acme/main/room/r2");
  });

  it("answers from the notification's Answer only after the microphone primer", async () => {
    await land({ room: "r1", call: "c1", answer: "1" });
    expect(ensureCallPermissions).toHaveBeenCalledWith(false, "c1");
    expect(mockCalls.joinFromPush).toHaveBeenCalledWith("r1", "c1");
    expect(mockCalls.ringFromPush).not.toHaveBeenCalled();
  });

  it("with the calls switch off, drops the ringing notification and opens the call's room", async () => {
    mockFlags.calls = false;
    await land({ room: "r1", call: "c1", answer: "1" });
    expect(mockNative.cancelIncomingCall).toHaveBeenCalledWith("c1");
    expect(mockCalls.joinFromPush).not.toHaveBeenCalled();
    expect(toasts()).toEqual([viText("mobile.calls.disabled")]);
    expect(mockRouter.push).toHaveBeenCalledWith("/acme/main/room/r1");
  });

  it("does nothing for params that name neither a room nor a person", async () => {
    await land({ call: "c1" });
    expect(mockRouter.setParams).toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();
    expect(mockCalls.ringFromPush).not.toHaveBeenCalled();
  });
});

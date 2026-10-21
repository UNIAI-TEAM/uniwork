// The Chat tab's deep links (use-deep-link-target.ts): each link is carried
// out once, its params are cleared, a DM opens only after the person agrees, and a call's push rings, answers after the
// microphone primer (only when the notification's own Answer vouched for it,
// never from a URL), or opens the room when the call is over or calls are off.
import { QueryClient } from "@tanstack/react-query";
import { act } from "@testing-library/react-native";
import { Alert, type AlertButton } from "react-native";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { workspaceMembersOptions } from "@/data/queries/chat";
import { useToastStore } from "@/data/stores/toast-store";
import { render, viText } from "@/test/render";
import type { ChatWorkspace } from "./use-chat-workspace";
import { useDeepLinkTarget } from "./use-deep-link-target";

// jest.mock factories run before this file's consts (the imports above are hoisted): each fake is
// made inside its factory, or read through a function at call time, and reached with jest.requireMock.
const mockParams: { current: Record<string, string | undefined> } = { current: {} };
jest.mock("expo-router", () => ({ router: { push: jest.fn(), setParams: jest.fn() }, useLocalSearchParams: () => mockParams.current }));
jest.mock("@/data/calls/call-store", () => ({ callEngine: { ringFromPush: jest.fn(async () => true), joinFromPush: jest.fn(async () => true) } }));
jest.mock("@/data/calls/native-calls", () => ({ nativeCalls: { cancelIncomingCall: jest.fn(), takeAnsweredCall: jest.fn(() => false) } }));
const mockFlags = { calls: true };
jest.mock("@/data/remote-config", () => ({ readMobileFlag: () => mockFlags.calls }));
const mockResolveDM = jest.fn(async (_userId: string): Promise<{ id: string } | null> => ({ id: "dm-1" }));
jest.mock("@/data/mutations/rooms", () => ({ useResolveDM: () => ({ mutateAsync: (userId: string) => mockResolveDM(userId) }) }));

const mockRouter = jest.requireMock<{ router: { push: jest.Mock; setParams: jest.Mock } }>("expo-router").router;
const mockCalls = jest.requireMock<{ callEngine: { ringFromPush: jest.Mock; joinFromPush: jest.Mock } }>("@/data/calls/call-store").callEngine;
const mockNative = jest.requireMock<{ nativeCalls: { cancelIncomingCall: jest.Mock; takeAnsweredCall: jest.Mock } }>("@/data/calls/native-calls").nativeCalls;

const chat: ChatWorkspace = { wsId: "w1", orgSlug: "acme", wsSlug: "main", workspaceName: "Main", userId: "me" };

function Probe({ chat: workspace }: { chat: ChatWorkspace | null }) {
  useDeepLinkTarget(workspace);
  return null;
}

const toasts = () => useToastStore.getState().toasts.map((toast) => toast.message);

/** The Alert's buttons: Cancel first, then Open. */
const alertButtons = () => (jest.mocked(Alert.alert).mock.calls.at(-1)?.[2] ?? []) as AlertButton[];

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(Alert, "alert").mockImplementation(() => undefined);
  mockNative.takeAnsweredCall.mockImplementation(() => false);
  mockFlags.calls = true;
  mockParams.current = {};
  useToastStore.setState({ toasts: [] });
});

// A toast arms its dismiss timer: cleared here so Jest exits once the run is over.
afterEach(async () => {
  await act(() => useToastStore.getState().clear());
});

async function land(params: Record<string, string | undefined>, workspace: ChatWorkspace | null = chat, queryClient?: QueryClient) {
  mockParams.current = params;
  const view = await render(<Probe chat={workspace} />, { queryClient });
  await act(async () => undefined);
  return view;
}

describe("useDeepLinkTarget", () => {
  it("opens a room at a message once, and clears the link's params", async () => {
    const view = await land({ room: "r1", message: "m1" });
    expect(mockRouter.setParams).toHaveBeenCalledWith({ room: undefined, message: undefined, dm: undefined, call: undefined });
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

  async function openFromAlert() {
    await act(async () => alertButtons()[1]?.onPress?.());
  }

  it("opens the DM with a person once they agree, or says it could not", async () => {
    await land({ dm: "u2" });
    expect(Alert.alert).toHaveBeenCalledWith(viText("mobile.security.dm_confirm_title"), viText("mobile.security.dm_confirm_body_unknown"), expect.any(Array));
    expect(mockResolveDM).not.toHaveBeenCalled();
    await openFromAlert();
    expect(mockResolveDM).toHaveBeenCalledWith("u2");
    expect(mockRouter.push).toHaveBeenCalledWith("/acme/main/room/dm-1");

    // No room back, and a failed request: each says the DM could not open (the toast store shows one copy at a time).
    mockResolveDM.mockResolvedValueOnce(null);
    await land({ dm: "u3" });
    await openFromAlert();
    expect(toasts()).toEqual([viText("chat.dm_failed")]);
    useToastStore.setState({ toasts: [] });
    mockResolveDM.mockRejectedValueOnce(new Error("offline"));
    await land({ dm: "u4" });
    await openFromAlert();
    expect(toasts()).toEqual([viText("chat.dm_failed")]);
  });

  // Audit (Security & privacy): a link from a page, a message or another app opened or created a DM on the account
  // as soon as the Chat tab mounted.
  it("asks before a link opens a DM, names the person it knows, and Cancel creates nothing", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    queryClient.setQueryData(workspaceMembersOptions("w1").queryKey, [
      { user_id: "U2", email: "binh@acme.vn", display_name: "Bình" },
      { user_id: "u5", email: "an@acme.vn", display_name: "" },
    ]);
    await land({ dm: "u2" }, chat, queryClient);
    expect(Alert.alert).toHaveBeenCalledWith(viText("mobile.security.dm_confirm_title"), viText("mobile.security.dm_confirm_body", { name: "Bình" }), expect.any(Array));
    const [cancel] = alertButtons();
    expect(cancel).toMatchObject({ text: viText("common.cancel"), style: "cancel" });
    expect(mockResolveDM).not.toHaveBeenCalled();
    expect(mockRouter.push).not.toHaveBeenCalled();

    // No display name: the email names them.
    await land({ dm: "u5" }, chat, queryClient);
    expect(Alert.alert).toHaveBeenLastCalledWith(viText("mobile.security.dm_confirm_title"), viText("mobile.security.dm_confirm_body", { name: "an@acme.vn" }), expect.any(Array));
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

  it("answers only what the notification's own Answer button vouched for, after the microphone primer", async () => {
    mockNative.takeAnsweredCall.mockImplementation((callId: string) => callId === "c1");
    await land({ room: "r1", call: "c1" });
    expect(mockNative.takeAnsweredCall).toHaveBeenCalledWith("c1");
    expect(ensureCallPermissions).toHaveBeenCalledWith(false, "c1");
    expect(mockCalls.joinFromPush).toHaveBeenCalledWith("r1", "c1");
    expect(mockCalls.ringFromPush).not.toHaveBeenCalled();
  });

  // Audit (Security & privacy, deeplink-auto-answer): a link, or an app on the phone firing the same VIEW intent,
  // used to connect the microphone to a ringing call with no tap.
  it("a link that asks to answer only rings: the microphone waits for the person's own tap", async () => {
    await land({ room: "r1", call: "c1", answer: "1" });
    expect(mockCalls.ringFromPush).toHaveBeenCalledWith("r1", "c1");
    expect(mockCalls.joinFromPush).not.toHaveBeenCalled();
    expect(ensureCallPermissions).not.toHaveBeenCalled();
  });

  it("with the calls switch off, drops the ringing notification and opens the call's room", async () => {
    mockFlags.calls = false;
    mockNative.takeAnsweredCall.mockReturnValue(true);
    await land({ room: "r1", call: "c1" });
    expect(mockNative.cancelIncomingCall).toHaveBeenCalledWith("c1");
    expect(mockCalls.joinFromPush).not.toHaveBeenCalled();
    expect(mockNative.takeAnsweredCall).not.toHaveBeenCalled();
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

import { act, fireEvent, screen } from "@testing-library/react-native";
import { createAudioPlayer } from "expo-audio";
import type { ReactNode } from "react";
import { BackHandler, Vibration } from "react-native";
import { setAppLockEngaged } from "@/data/stores/app-lock-store";
import { ensureCallPermissions } from "@/components/ui/permission-gate";
import { callEngine } from "@/data/calls/call-store";
import { chatApi } from "@/data/chat-api";
import { nativeCalls } from "@/data/calls/native-calls";
import { useWorkspaceStore } from "@/data/stores/workspace-store";
import type { VoiceCallOverlayState } from "@uniwork/core/chat/voice-call-types";
import { render, viText } from "@/test/render";
import { CallOverlay } from "./call-overlay";

// The permission gate grants everything here: this test is about its caller. The gate itself, on the
// expo permission modules, is components/ui/permission-gate.test.tsx.
jest.mock("@/components/ui/permission-gate", () => ({
  permissionGate: { ensure: jest.fn(async () => true) },
  ensureCallPermissions: jest.fn(async () => undefined),
}));

// The LiveKit room needs WebRTC; a stand-in exposes what the overlay hands it.
jest.mock("./call-room", () => ({
  CallRoom: (props: { peerName: string; recording: boolean; onMinimize?: () => void; minimized?: boolean }): ReactNode => {
    const { Pressable: P, Text: T } = jest.requireActual<typeof import("react-native")>("react-native");
    const label = <T>{`room:${props.peerName}:${props.recording ? "recording" : "quiet"}${props.minimized ? ":shrunk" : ""}`}</T>;
    return props.onMinimize ? (
      <P accessibilityRole="button" accessibilityLabel="minimize" onPress={props.onMinimize}>
        {label}
      </P>
    ) : (
      label
    );
  },
}));

// The lock-screen hold of an Android call launch (modules/unichat-calls › CallLockScreen.leave): not held unless a test says.
jest.mock("@/data/calls/native-calls", () => ({ nativeCalls: { leaveLockScreen: jest.fn(async () => true) } }));
const leaveLockScreen = jest.mocked(nativeCalls.leaveLockScreen);

const setCall = (call: VoiceCallOverlayState) => act(() => callEngine.store.setState({ call }));
const base = { callId: "call-1", roomId: "dm1", peerName: "Bình", callKind: "dm" as const };

beforeEach(() => {
  leaveLockScreen.mockClear();
  useWorkspaceStore.setState({ current: { orgSlug: "acme", wsSlug: "hq", wsId: "w1" } as never });
  jest.spyOn(chatApi, "listRooms").mockResolvedValue([]);
  jest.spyOn(chatApi, "callRecordingActive").mockResolvedValue(false);
});
afterEach(async () => {
  await setCall({ status: "idle" });
  await act(() => setAppLockEngaged(false));
  jest.restoreAllMocks();
});

describe("CallOverlay", () => {
  it("draws nothing without a call", async () => {
    await render(<CallOverlay />);
    expect(screen.toJSON()).toBeNull();
  });

  it("rings for an incoming call and answers or declines it", async () => {
    const accept = jest.spyOn(callEngine, "acceptCall").mockResolvedValue(undefined as never);
    const hangUp = jest.spyOn(callEngine, "hangUp").mockResolvedValue(undefined as never);
    await render(<CallOverlay />);
    await setCall({ status: "incoming", ...base });
    expect(screen.getByText("Bình")).toBeOnTheScreen();
    expect(screen.getByText(viText("chat.voice_call_incoming_label"))).toBeOnTheScreen();
    expect(createAudioPlayer).toHaveBeenCalled();
    expect(Vibration.vibrate).toHaveBeenCalled();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_call_accept") }));
    expect(accept).toHaveBeenCalledWith("call-1");
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_call_decline") }));
    expect(hangUp).toHaveBeenCalled();
  });

  it("never answers a call that rang in while the microphone primer was open for another", async () => {
    let primerClosed = (): void => undefined;
    jest.mocked(ensureCallPermissions).mockReturnValueOnce(new Promise<void>((resolve) => (primerClosed = resolve)));
    const accept = jest.spyOn(callEngine, "acceptCall");
    await render(<CallOverlay />);
    await setCall({ status: "incoming", ...base });
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_call_accept") }));
    // call-1 ends and call-2 rings before the person answers the primer.
    await setCall({ status: "incoming", ...base, callId: "call-2" });
    await act(async () => primerClosed());
    expect(accept).toHaveBeenCalledWith("call-1");
    expect(callEngine.store.getState().call).toMatchObject({ status: "incoming", callId: "call-2" });
  });

  it("names the caller and the group on an incoming group call", async () => {
    await render(<CallOverlay />);
    await setCall({ status: "incoming", ...base, roomId: "g1", peerName: "Thiết kế", callKind: "group", callerName: "An" });
    expect(screen.getByText(viText("chat.voice_call_incoming_group", { caller: "An", group: "Thiết kế" }))).toBeOnTheScreen();
  });

  it.each([
    ["ringing", "chat.voice_call_calling"],
    ["connecting", "chat.voice_call_connecting"],
  ] as const)("hangs up while %s", async (status, line) => {
    const hangUp = jest.spyOn(callEngine, "hangUp").mockResolvedValue(undefined as never);
    await render(<CallOverlay />);
    await setCall({ status, ...base, outgoing: true });
    expect(screen.getByText(viText(line))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_call_end") }));
    expect(hangUp).toHaveBeenCalled();
  });

  it("shrinks a live call to a pill that brings it back, and asks whether it is recorded", async () => {
    jest.mocked(chatApi.callRecordingActive).mockResolvedValue(true);
    await render(<CallOverlay />);
    await setCall({ status: "active", ...base, outgoing: true, token: "t", url: "wss://lk" });
    expect(await screen.findByText("room:Bình:recording")).toBeOnTheScreen();
    expect(chatApi.callRecordingActive).toHaveBeenCalledWith("w1", "dm1", "call-1");
    await fireEvent.press(screen.getByRole("button", { name: "minimize" }));
    const pill = screen.getByRole("button", { name: `${viText("chat.mobile.call_back_to")}, Bình` });
    // The room stays mounted and knows it is shrunk (its proximity wake lock lets go).
    expect(screen.getByText("room:Bình:recording:shrunk", { includeHiddenElements: true })).toBeTruthy();
    await fireEvent.press(pill);
    expect(screen.queryByRole("button", { name: `${viText("chat.mobile.call_back_to")}, Bình` })).toBeNull();
    expect(screen.getByText("room:Bình:recording")).toBeOnTheScreen();
  });

  it("shrinks a call shown over the phone's lock screen only once the person unlocks it", async () => {
    let unlock: (left: boolean) => void = () => undefined;
    leaveLockScreen.mockReturnValueOnce(new Promise((resolve) => (unlock = resolve)));
    await render(<CallOverlay />);
    await setCall({ status: "active", ...base, outgoing: true, token: "t", url: "wss://lk" });
    await fireEvent.press(await screen.findByRole("button", { name: "minimize" }));
    const pill = () => screen.queryByRole("button", { name: `${viText("chat.mobile.call_back_to")}, Bình` });
    // Android shows its PIN prompt; the call screen waits, and cancelling it keeps the call whole.
    expect(pill()).toBeNull();
    await act(async () => unlock(false));
    expect(pill()).toBeNull();
    expect(screen.getByText("room:Bình:quiet")).toBeOnTheScreen();
    // Unlocked: the call shrinks and the app shows.
    await fireEvent.press(screen.getByRole("button", { name: "minimize" }));
    expect(leaveLockScreen).toHaveBeenCalledTimes(2);
    expect(pill()).toBeOnTheScreen();
  });

  it("cannot shrink while the app lock is engaged, and a shrunk call takes the screen again when it engages", async () => {
    await render(<CallOverlay />);
    await setCall({ status: "active", ...base, outgoing: true, token: "t", url: "wss://lk" });
    await fireEvent.press(await screen.findByRole("button", { name: "minimize" }));
    const pill = () => screen.queryByRole("button", { name: `${viText("chat.mobile.call_back_to")}, Bình` });
    expect(pill()).toBeOnTheScreen();
    // The lock comes back (the relock time passed in the background): the call covers the app again, nothing past it.
    await act(() => setAppLockEngaged(true));
    expect(pill()).toBeNull();
    expect(screen.getByText("room:Bình:quiet")).toBeOnTheScreen();
    expect(screen.queryByRole("button", { name: "minimize" })).toBeNull();
    // Opened again: the call is where the person left it.
    await act(() => setAppLockEngaged(false));
    expect(pill()).toBeOnTheScreen();
  });

  it("takes the whole screen again when a shrunk call ends", async () => {
    jest.mocked(chatApi.listRooms).mockResolvedValue([{ id: "dm1", kind: "dm", name: "Bình", workspace_id: "w1", peer_user_id: "u2", member_user_ids: [], member_count: 2, unread_count: 0, mention_unread_count: 0 }] as never);
    await render(<CallOverlay />);
    await setCall({ status: "active", ...base, outgoing: true, token: "t", url: "wss://lk" });
    await fireEvent.press(await screen.findByRole("button", { name: "minimize" }));
    expect(screen.getByRole("button", { name: `${viText("chat.mobile.call_back_to")}, Bình` })).toBeOnTheScreen();
    await setCall({ status: "ended", reason: "peer_left", roomId: "dm1", peerName: "Bình", callKind: "dm", outgoing: true });
    expect(screen.queryByRole("button", { name: `${viText("chat.mobile.call_back_to")}, Bình` })).toBeNull();
    expect(screen.getByRole("button", { name: viText("common.close") })).toBeOnTheScreen();
  });

  it("says why a call ended and offers to call back", async () => {
    const dismiss = jest.spyOn(callEngine, "dismissEnded");
    const start = jest.spyOn(callEngine, "startCall").mockResolvedValue(undefined as never);
    await render(<CallOverlay />);
    await setCall({ status: "ended", reason: "no_answer", roomId: "dm1", peerName: "Bình", callKind: "dm", outgoing: true, withCamera: true });
    expect(screen.getByText(viText("chat.voice_call_ended_no_answer"))).toBeOnTheScreen();
    await fireEvent.press(screen.getByRole("button", { name: viText("chat.voice_call_call_back") }));
    expect(dismiss).toHaveBeenCalled();
    expect(start).toHaveBeenCalledWith("dm1", "Bình", "dm", { withCamera: true });
  });

  it("offers a retry after a failure and only a close after the other side hung up", async () => {
    await render(<CallOverlay />);
    await setCall({ status: "ended", reason: "connect_failed", roomId: "dm1", peerName: "Bình", callKind: "dm", outgoing: true });
    expect(screen.getByRole("button", { name: viText("common.retry") })).toBeOnTheScreen();
    await setCall({ status: "ended", reason: "peer_ended", roomId: "dm1", peerName: "Bình", callKind: "dm", outgoing: false });
    expect(screen.queryByRole("button", { name: viText("common.retry") })).toBeNull();
    expect(screen.queryByRole("button", { name: viText("chat.voice_call_call_back") })).toBeNull();
    const dismiss = jest.spyOn(callEngine, "dismissEnded");
    await fireEvent.press(screen.getByRole("button", { name: viText("common.close") }));
    expect(dismiss).toHaveBeenCalled();
  });

  it("lets Android's back button close a finished call's panel, and swallows it during a call", async () => {
    const listeners: Array<Parameters<typeof BackHandler.addEventListener>[1]> = [];
    jest.spyOn(BackHandler, "addEventListener").mockImplementation((_event, handler) => {
      listeners.push(handler);
      return { remove: jest.fn() };
    });
    const pressBack = async () => {
      let handled: boolean | null | undefined;
      await act(() => {
        handled = listeners.at(-1)?.({ type: "hardwareBackPress", timeStamp: 0 });
      });
      return handled;
    };
    const dismiss = jest.spyOn(callEngine, "dismissEnded");
    await render(<CallOverlay />);
    await setCall({ status: "ended", reason: "peer_ended", roomId: "dm1", peerName: "Bình", callKind: "dm", outgoing: false });
    expect(await pressBack()).toBe(true);
    expect(dismiss).toHaveBeenCalledTimes(1);
    // A live call stays up: back is consumed, and dismissEnded leaves a call that has not ended alone.
    dismiss.mockRestore();
    await setCall({ status: "active", ...base, outgoing: true, token: "t", url: "wss://lk" });
    expect(await pressBack()).toBe(true);
    expect(callEngine.store.getState().call.status).toBe("active");
  });
});

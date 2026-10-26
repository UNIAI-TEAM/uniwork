// The app's one call engine (call-store.ts): wired to the chat API, a hangup
// tells every listener once the server answered it (or failed to), so the call
// log the server wrote can be read; a listener that left hears nothing; the
// hook reads the call state from the engine's store.
import { renderHook } from "@testing-library/react-native";
import { chatApi } from "@/data/chat-api";
import type { CallEngineDeps } from "./call-engine";
import { callEngine, onHangupSettled, useVoiceCall } from "./call-store";

jest.mock("@/data/chat-api", () => ({
  chatApi: {
    signalVoiceInvite: jest.fn(),
    signalVoiceAccept: jest.fn(),
    signalVoiceHangup: jest.fn(),
    listPendingVoiceInvites: jest.fn(),
    listOutgoingVoiceCalls: jest.fn(),
    mintVoiceToken: jest.fn(),
  },
}));
jest.mock("./call-engine", () => ({
  createCallEngine: jest.fn((deps: unknown) => {
    const { createStore } = jest.requireActual<typeof import("zustand/vanilla")>("zustand/vanilla");
    return { deps, store: createStore(() => ({ call: { status: "ringing", callId: "c1" } })) };
  }),
}));

const deps = (callEngine as unknown as { deps: CallEngineDeps }).deps;

describe("call-store", () => {
  it("passes the chat API to the engine and makes call ids the server accepts", () => {
    expect(deps.invite).toBe(chatApi.signalVoiceInvite);
    expect(deps.mintToken).toBe(chatApi.mintVoiceToken);
    expect(deps.createCallId()).toMatch(/^[A-Za-z0-9-]+$/);
  });

  it("tells each listener once a hangup is answered or fails, and nobody who left", async () => {
    const heard = jest.fn();
    const left = jest.fn();
    onHangupSettled(heard);
    const leave = onHangupSettled(left);
    leave();
    jest.mocked(chatApi.signalVoiceHangup).mockResolvedValueOnce(true);
    await expect(deps.hangup("w1", "r1", "c1", 12)).resolves.toBe(true);
    expect(chatApi.signalVoiceHangup).toHaveBeenCalledWith("w1", "r1", "c1", 12);
    jest.mocked(chatApi.signalVoiceHangup).mockRejectedValueOnce(new Error("offline"));
    await expect(deps.hangup("w2", "r1", "c1")).rejects.toThrow("offline");
    expect(heard.mock.calls).toEqual([["w1"], ["w2"]]);
    expect(left).not.toHaveBeenCalled();
  });

  it("reads the call from the engine's store", async () => {
    const { result } = await renderHook(() => useVoiceCall());
    expect(result.current).toEqual({ status: "ringing", callId: "c1" });
  });
});

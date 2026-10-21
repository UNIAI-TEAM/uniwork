// The mutation layer (data/mutations/command.ts): each hook runs its command
// with the workspace, room and person it was bound to, under a mutation key
// that names it, so a failure reaches the MutationCache (crash reporting)
// once and the screen's own rejection handler.
import { MutationCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import type { ReactNode } from "react";

jest.mock("../chat-actions", () => ({
  togglePin: jest.fn(async () => undefined),
  followUpCommand: jest.fn(async () => undefined),
  createTaskFromMessage: jest.fn(async () => ({ id: "t1" })),
  forwardMessage: jest.fn(async () => undefined),
  setRoomMuted: jest.fn(async () => undefined),
  leaveRoom: jest.fn(async () => undefined),
  resolveDMRoom: jest.fn(async () => ({ id: "dm1" })),
  joinChannel: jest.fn(async () => ({ id: "c1" })),
  createGroup: jest.fn(async () => ({ id: "g1" })),
  inviteGroupMembers: jest.fn(async () => ({ id: "g1" })),
  markThreadRead: jest.fn(async () => null),
}));
jest.mock("../chat-send", () => ({
  chatSendDeps: { tag: "send-deps" },
  sendChatMessage: jest.fn(async () => undefined),
  retryPendingSend: jest.fn(async () => undefined),
  discardPendingSend: jest.fn(),
}));
jest.mock("../pending-ops", () => ({
  editMessage: jest.fn(async () => undefined),
  deleteMessage: jest.fn(async () => undefined),
  markRoomRead: jest.fn(async () => undefined),
  toggleReaction: jest.fn(async () => undefined),
  votePoll: jest.fn(async () => undefined),
}));
jest.mock("../chat-api", () => ({
  chatApi: { signalTyping: jest.fn(async () => true), catchUp: jest.fn(async () => ({ message_count: 1 })) },
}));
jest.mock("../safety-actions", () => ({ setBlocked: jest.fn(async () => undefined) }));
jest.mock("../safety-api", () => ({ safetyApi: { report: jest.fn(async () => ({ id: "rep1" })) } }));
jest.mock("../account-api", () => ({ accountApi: { deleteAccount: jest.fn(async () => undefined) } }));
jest.mock("../ai-consent", () => ({ answerAiConsent: jest.fn(async () => undefined) }));
jest.mock("../api", () => ({ api: { tag: "transport" } }));
jest.mock("../calls/native-calls", () => ({ nativeCalls: { available: true } }));
jest.mock("../push", () => ({ setPushEnabled: jest.fn(async () => "ExponentPushToken[x]") }));
jest.mock("expo-constants", () => ({ expoConfig: { extra: { eas: { projectId: "proj-1" } } } }));
jest.mock("../queries/devices", () => ({
  deviceKeys: { all: () => ["auth-devices"] },
  revokeDevice: jest.fn(async () => undefined),
}));

import * as actions from "../chat-actions";
import { chatApi } from "../chat-api";
import * as send from "../chat-send";
import * as ops from "../pending-ops";
import { revokeDevice } from "../queries/devices";
import { setBlocked } from "../safety-actions";
import { safetyApi } from "../safety-api";
import { accountApi } from "../account-api";
import { answerAiConsent } from "../ai-consent";
import { api } from "../api";
import { setPushEnabled } from "../push";
import { Platform } from "react-native";
import { useAnswerAiConsent, useDeleteAccount, useRevokeDevice } from "./account";
import { useSetPushEnabled } from "./push";
import {
  useCreateTask,
  useDeleteMessage,
  useDiscardSend,
  useEditMessage,
  useFollowUp,
  useForwardMessage,
  useMarkRoomRead,
  useReact,
  useRetrySend,
  useSendMessage,
  useSignalTyping,
  useTogglePin,
  useVotePoll,
} from "./messages";
import { useCatchUp, useCreateGroup, useInviteGroupMembers, useJoinChannel, useLeaveRoom, useMarkThreadRead, useResolveDM, useSetRoomMuted } from "./rooms";
import { useBlockUser, useReport } from "./safety";

const onMutationError = jest.fn();
let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  qc = new QueryClient({ mutationCache: new MutationCache({ onError: onMutationError }), defaultOptions: { mutations: { retry: false } } });
});
const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
const hook = async <T,>(use: () => T) => (await renderHook(use, { wrapper })).result;

/** Runs one mutation of the hook and hands back what it resolved to. */
async function run<V, R>(use: () => { mutateAsync: (v: V) => Promise<R> }, variables: V): Promise<R> {
  const result = await hook(use);
  let value: R | undefined;
  await act(async () => {
    value = await result.current.mutateAsync(variables);
  });
  return value as R;
}

describe("message commands", () => {
  it("bind the workspace, the room and the person, and hand the cache's client to the command", async () => {
    await run(() => useEditMessage("w1", "r1", "u1"), { messageId: "m1", body: "sửa" });
    expect(ops.editMessage).toHaveBeenCalledWith(qc, "w1", "r1", "m1", "sửa", "u1");
    await run(() => useDeleteMessage("w1", "r1", "u1"), "m1");
    expect(ops.deleteMessage).toHaveBeenCalledWith(qc, "w1", "r1", "m1", "u1");
    await run(() => useTogglePin("w1", "r1"), "m1");
    expect(actions.togglePin).toHaveBeenCalledWith(qc, "w1", "r1", "m1");
    await run(() => useReact("w1", "r1", "u1"), { messageId: "m1", emoji: "👍" });
    expect(ops.toggleReaction).toHaveBeenCalledWith(qc, "w1", "r1", "m1", "👍", "u1");
    await run(() => useVotePoll("w1", "r1", "u1"), { messageId: "m1", optionId: "o1" });
    expect(ops.votePoll).toHaveBeenCalledWith(qc, "w1", "r1", "m1", "o1", "u1");
    await run(() => useFollowUp("w1"), { command: "complete", id: "f1" });
    expect(actions.followUpCommand).toHaveBeenCalledWith(qc, "w1", "complete", "f1");
    expect(await run(() => useCreateTask("w1", "r1"), { followUpId: "f1" })).toEqual({ id: "t1" });
    expect(actions.createTaskFromMessage).toHaveBeenCalledWith(qc, "w1", "r1", { followUpId: "f1" });
    await run(() => useForwardMessage("w1"), { messageId: "m1", roomIds: ["r2"] });
    expect(actions.forwardMessage).toHaveBeenCalledWith("w1", "m1", ["r2"]);
  });

  it("send, retry and discard go through the outbox with its dependencies", async () => {
    await run(() => useSendMessage("w1", "r1", "u1"), { body: "chào" });
    expect(send.sendChatMessage).toHaveBeenCalledWith(qc, { workspaceId: "w1", roomId: "r1", senderId: "u1", body: "chào" }, send.chatSendDeps);
    const entry = { clientMsgId: "c1" } as never;
    await run(() => useRetrySend(), entry);
    expect(send.retryPendingSend).toHaveBeenCalledWith(qc, entry, send.chatSendDeps);
    const discard = await hook(() => useDiscardSend());
    discard.current("c1");
    expect(send.discardPendingSend).toHaveBeenCalledWith("c1", send.chatSendDeps);
  });

  it("typing and reads are fire-and-forget callbacks, stable across renders", async () => {
    const typing = await renderHook(({ room }: { room: string }) => useSignalTyping("w1", room), { wrapper, initialProps: { room: "r1" } });
    const first = typing.result.current;
    await typing.rerender({ room: "r1" });
    expect(typing.result.current).toBe(first);
    jest.mocked(chatApi.signalTyping).mockRejectedValueOnce(new Error("offline"));
    await act(async () => typing.result.current());
    expect(chatApi.signalTyping).toHaveBeenCalledWith("w1", "r1");
    const read = await hook(() => useMarkRoomRead());
    read.current("w1", "r1", "u1");
    expect(ops.markRoomRead).toHaveBeenCalledWith(qc, "w1", "r1", "u1");
  });
});

describe("room commands", () => {
  it("bind the workspace (and the group) to each command", async () => {
    await run(() => useSetRoomMuted("w1"), { roomId: "r1", muted: true });
    expect(actions.setRoomMuted).toHaveBeenCalledWith(qc, "w1", "r1", true);
    await run(() => useLeaveRoom("w1"), "r1");
    expect(actions.leaveRoom).toHaveBeenCalledWith(qc, "w1", "r1");
    expect(await run(() => useResolveDM("w1"), "u2")).toEqual({ id: "dm1" });
    expect(actions.resolveDMRoom).toHaveBeenCalledWith(qc, "w1", "u2");
    await run(() => useJoinChannel("w1"), "c1");
    expect(actions.joinChannel).toHaveBeenCalledWith(qc, "w1", "c1");
    await run(() => useCreateGroup("w1"), { name: "Đội", memberUserIds: ["u2", "u3"] });
    expect(actions.createGroup).toHaveBeenCalledWith(qc, "w1", { name: "Đội", memberUserIds: ["u2", "u3"] });
    await run(() => useInviteGroupMembers("w1", "g1"), ["u4"]);
    expect(actions.inviteGroupMembers).toHaveBeenCalledWith(qc, "w1", "g1", ["u4"]);
    await run(() => useMarkThreadRead("w1"), "root");
    expect(actions.markThreadRead).toHaveBeenCalledWith("w1", "root");
    expect(await run(() => useCatchUp("w1"), { roomId: "r1", locale: "en" })).toEqual({ message_count: 1 });
    expect(chatApi.catchUp).toHaveBeenCalledWith("w1", { room_id: "r1", locale: "en" });
  });
});

describe("safety and account commands", () => {
  it("block, report and delete the account through their commands", async () => {
    await run(() => useBlockUser("w1"), { userId: "u2", blocked: true });
    expect(setBlocked).toHaveBeenCalledWith(qc, "w1", "u2", true);
    const body = { reason: "spam", target_message_id: "m1" } as never;
    expect(await run(() => useReport("w1"), body)).toEqual({ id: "rep1" });
    expect(safetyApi.report).toHaveBeenCalledWith("w1", body);
    const proof = { password: "x" } as never;
    await run(() => useDeleteAccount(), proof);
    expect(accountApi.deleteAccount).toHaveBeenCalledWith(proof);
  });

  it("answers the AI notice and turns push on or off with this build's project and call UI", async () => {
    await run(() => useAnswerAiConsent(), true);
    await run(() => useAnswerAiConsent(), false);
    expect(jest.mocked(answerAiConsent).mock.calls).toEqual([[true], [false]]);
    const ask = jest.fn(async () => true);
    expect(await run(() => useSetPushEnabled(), { enabled: true, ask })).toBe("ExponentPushToken[x]");
    expect(setPushEnabled).toHaveBeenCalledWith(true, { api, projectId: "proj-1", platform: Platform.OS, callUI: true, ask });
    await run(() => useSetPushEnabled(), { enabled: false });
    expect(setPushEnabled).toHaveBeenLastCalledWith(false, { api, projectId: "proj-1", platform: Platform.OS, callUI: true, ask: undefined });
  });

  it("refreshes the device list after a revoke, whether or not the server agreed", async () => {
    const invalidate = jest.spyOn(qc, "invalidateQueries");
    await run(() => useRevokeDevice(), "d1");
    expect(revokeDevice).toHaveBeenCalledWith("d1");
    jest.mocked(revokeDevice).mockRejectedValueOnce(new Error("refused"));
    await expect(run(() => useRevokeDevice(), "d2")).rejects.toThrow("refused");
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([["auth-devices"], ["auth-devices"]]);
  });
});

describe("a failing command", () => {
  it("rejects the screen's promise and reaches the MutationCache once, keyed by the command's name", async () => {
    jest.mocked(ops.deleteMessage).mockRejectedValueOnce(new Error("chat_message_delete_failed"));
    await expect(run(() => useDeleteMessage("w1", "r1", "u1"), "m1")).rejects.toThrow("chat_message_delete_failed");
    expect(onMutationError).toHaveBeenCalledTimes(1);
    const [, , , mutation] = onMutationError.mock.calls[0] as [unknown, unknown, unknown, { options: { mutationKey: unknown } }];
    expect(mutation.options.mutationKey).toEqual(["chat.delete_message"]);
  });
});

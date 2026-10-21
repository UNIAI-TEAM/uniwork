// S7 review P0: a message, a retry, a reaction, a poll vote, an edit or a delete made offline
// must reach the outbox at once, through the real commands. TanStack's default
// `networkMode: "online"` would hold the mutation paused while NetInfo says
// offline, so nothing would be queued, the bubble would not show and a kill
// before the network came back would lose the message. The commands decide
// online/offline themselves (data/chat-send.ts, data/pending-ops.ts).
import { MutationCache, onlineManager, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react-native";
import type { ChatMessageRecord } from "@uniwork/core/api/endpoints/chat-schemas";
import type { ReactNode } from "react";

// The transport: offline, nothing may reach it.
jest.mock("../api", () => ({ api: { request: jest.fn(async () => { throw new Error("no network in this test"); }) } }));

import { api } from "../api";
import { chatKeys } from "../queries/chat-keys";
import { useChatSendStore } from "../stores/chat-send-store";
import { usePendingOpsStore } from "../stores/pending-ops-store";
import { useDeleteMessage, useEditMessage, useReact, useRetrySend, useSendMessage, useTogglePin, useVotePoll } from "./messages";

const settings = { deadline_at: null, pin_to_top: false, allow_multiple: false, allow_add_options: true, hide_results_until_vote: false, hide_voters: false };
const message = (id: string, extra: Partial<ChatMessageRecord> = {}) =>
  ({
    id,
    room_id: "r1",
    workspace_id: "w1",
    sender_id: "u2",
    kind: "text",
    body: "hi",
    created_at: "2026-10-17T10:00:00Z",
    reactions: {},
    my_reactions: [],
    mentioned_user_ids: [],
    ...extra,
  }) as unknown as ChatMessageRecord;
const poll = message("p1", { kind: "poll", poll: { question: "?", options: [{ id: "a", label: "A", votes: 0 }], settings, viewer_option_ids: [], votes_by_user: {} } } as Partial<ChatMessageRecord>);

let qc: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  useChatSendStore.getState().clear();
  usePendingOpsStore.getState().clear();
  qc = new QueryClient({ mutationCache: new MutationCache(), defaultOptions: { mutations: { retry: false } } });
  qc.setQueryData(chatKeys.roomMessages("w1", "r1"), { pages: [[message("m1"), poll]], pageParams: [null] });
  onlineManager.setOnline(false);
});
afterEach(() => onlineManager.setOnline(true));

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;

/** Fires the mutation and lets it settle, without waiting for the network to come back. */
async function fire<V>(use: () => { mutate: (v: V) => void }, variables: V) {
  const { result } = await renderHook(use, { wrapper });
  await act(async () => {
    result.current.mutate(variables);
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("offline commands", () => {
  it("a send is queued in the outbox at once, before the network is back", async () => {
    await fire(() => useSendMessage("w1", "r1", "u1"), { body: "chào" });
    expect(useChatSendStore.getState().entries).toEqual([expect.objectContaining({ roomId: "r1", body: "chào", status: "queued" })]);
    expect(api.request).not.toHaveBeenCalled();
    expect(qc.getMutationCache().getAll().some((m) => m.state.isPaused)).toBe(false);
  });

  it("a retry puts a failed message back in its room's line", async () => {
    await fire(() => useSendMessage("w1", "r1", "u1"), { body: "chào" });
    const [entry] = useChatSendStore.getState().entries;
    useChatSendStore.getState().setStatus(entry!.clientMsgId, "failed");
    await fire(() => useRetrySend(), { ...entry!, status: "failed" as const });
    expect(useChatSendStore.getState().entries[0]?.status).toBe("queued");
  });

  it("a reaction and a poll vote are put in the pending-ops store", async () => {
    await fire(() => useReact("w1", "r1", "u1"), { messageId: "m1", emoji: "👍" });
    await fire(() => useVotePoll("w1", "r1", "u1"), { messageId: "p1", optionId: "a" });
    expect(usePendingOpsStore.getState().ops.map((op) => op.kind).sort()).toEqual(["reaction", "vote"]);
    expect(api.request).not.toHaveBeenCalled();
  });

  // Audit "edit-delete-online-only": both waited for the server and failed offline.
  it("an edit and a delete show at once and are put in the pending-ops store", async () => {
    await fire(() => useEditMessage("w1", "r1", "u1"), { messageId: "m1", body: "sửa" });
    const shown = () => qc.getQueryData<{ pages: ChatMessageRecord[][] }>(chatKeys.roomMessages("w1", "r1"))!.pages[0]!;
    expect(shown().find((m) => m.id === "m1")?.body).toBe("sửa");
    await fire(() => useDeleteMessage("w1", "r1", "u1"), "p1");
    expect(shown().map((m) => m.id)).toEqual(["m1"]);
    expect(usePendingOpsStore.getState().ops.map((op) => op.kind).sort()).toEqual(["delete", "edit"]);
    expect(api.request).not.toHaveBeenCalled();
  });

  it("a server-only command fails now instead of hanging paused", async () => {
    const { result } = await renderHook(() => useTogglePin("w1", "r1"), { wrapper });
    await act(async () => {
      await expect(result.current.mutateAsync("m1")).rejects.toBeDefined();
    });
  });
});

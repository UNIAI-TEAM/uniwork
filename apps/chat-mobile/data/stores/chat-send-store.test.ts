import { beforeEach, describe, expect, it } from "vitest";
import type { PendingSend } from "@/lib/send-pipeline";
import { useChatSendStore } from "./chat-send-store";

const entry = (clientMsgId: string): PendingSend => ({
  workspaceId: "w1",
  roomId: "r1",
  senderId: "u1",
  clientMsgId,
  body: clientMsgId,
  createdAt: 1,
  status: "queued",
});

beforeEach(() => useChatSendStore.getState().clear());

describe("chat send store", () => {
  it("keeps one entry per client_msg_id and moves only the named one's status", () => {
    const store = useChatSendStore.getState();
    store.upsert(entry("a"));
    store.upsert(entry("b"));
    store.upsert({ ...entry("a"), body: "again" });
    useChatSendStore.getState().setStatus("a", "failed");
    expect(useChatSendStore.getState().entries.map((e) => [e.clientMsgId, e.status, e.body])).toEqual([
      ["b", "queued", "b"],
      ["a", "failed", "again"],
    ]);
    useChatSendStore.getState().remove("b");
    expect(useChatSendStore.getState().entries.map((e) => e.clientMsgId)).toEqual(["a"]);
  });
});

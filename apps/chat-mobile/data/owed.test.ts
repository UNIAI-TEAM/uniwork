// What the phone owes goes for the whole account: the outbox and the queued reads of every workspace.
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));
vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
const flushAllQueuedSends = vi.hoisted(() => vi.fn(async () => undefined));
const flushAllPendingOps = vi.hoisted(() => vi.fn(async () => undefined));
const sendsSettled = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./chat-send", () => ({ chatSendDeps: { name: "sends" }, flushAllQueuedSends, sendsSettled }));
vi.mock("./pending-ops", () => ({ pendingOpsDeps: { name: "ops" }, flushAllPendingOps }));

import type { PendingSend } from "@/lib/send-pipeline";
import { deliverOwed, flushOwed, owesServer } from "./owed";
import { REMOTE_CONFIG_FALLBACK, remoteConfigKey } from "./remote-config";
import { useChatSendStore } from "./stores/chat-send-store";
import { usePendingOpsStore } from "./stores/pending-ops-store";

describe("flushOwed", () => {
  it("flushes the sends and the queued ops of every workspace for the person, with the app's wiring by default", async () => {
    const qc = new QueryClient();
    await flushOwed(qc, "u1");
    expect(flushAllQueuedSends).toHaveBeenCalledWith(qc, "u1", { name: "sends" });
    expect(flushAllPendingOps).toHaveBeenCalledWith(qc, "u1", { name: "ops" });
  });

  it("re-sends nothing while the server's outbox switch is off, and again once it is back on", async () => {
    vi.clearAllMocks();
    const qc = new QueryClient();
    qc.setQueryData(remoteConfigKey, { ...REMOTE_CONFIG_FALLBACK, flags: { unichat_mobile_outbox_flush: false } });
    await flushOwed(qc, "u1");
    expect(flushAllQueuedSends).not.toHaveBeenCalled();
    expect(flushAllPendingOps).not.toHaveBeenCalled();
    qc.setQueryData(remoteConfigKey, { ...REMOTE_CONFIG_FALLBACK, flags: { unichat_mobile_outbox_flush: true } });
    await flushOwed(qc, "u1");
    expect(flushAllQueuedSends).toHaveBeenCalledTimes(1);
  });
});

describe("deliverOwed", () => {
  it("flushes what is owed, then waits for the sends already on the wire", async () => {
    vi.clearAllMocks();
    const order: string[] = [];
    flushAllQueuedSends.mockImplementationOnce(async () => void order.push("flush"));
    sendsSettled.mockImplementationOnce(async () => void order.push("settled"));
    await deliverOwed(new QueryClient(), "u1");
    expect(order).toEqual(["flush", "settled"]);
  });
});

describe("owesServer", () => {
  const send = (over: Partial<PendingSend>): PendingSend => ({
    workspaceId: "w1",
    roomId: "r1",
    senderId: "u1",
    clientMsgId: "c1",
    body: "hi",
    createdAt: 1,
    status: "queued",
    ...over,
  });
  const read = (userId: string) => ({ kind: "read" as const, key: `read/w1/r1/${userId}`, workspaceId: "w1", roomId: "r1", userId, createdAt: 1, rev: 1, verify: false });

  it("is true while one of the person's messages waits or is on the wire, never for a refused one or someone else's", () => {
    useChatSendStore.getState().clear();
    usePendingOpsStore.getState().clear();
    useChatSendStore.getState().upsert(send({ clientMsgId: "failed", status: "failed" }));
    useChatSendStore.getState().upsert(send({ clientMsgId: "theirs", senderId: "u9" }));
    expect(owesServer("u1")).toBe(false);
    useChatSendStore.getState().upsert(send({ clientMsgId: "sending", status: "sending" }));
    expect(owesServer("u1")).toBe(true);
    useChatSendStore.getState().setStatus("sending", "queued");
    expect(owesServer("u1")).toBe(true);
  });

  it("is true while one of the person's reads, reactions, votes, edits or deletes waits, not someone else's", () => {
    useChatSendStore.getState().clear();
    usePendingOpsStore.getState().clear();
    usePendingOpsStore.getState().put(read("u9"));
    expect(owesServer("u1")).toBe(false);
    usePendingOpsStore.getState().put(read("u1"));
    expect(owesServer("u1")).toBe(true);
  });
});

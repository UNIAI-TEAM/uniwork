// What the phone owes goes for the whole account: the outbox and the queued reads of every workspace.
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn() } }));
vi.mock("expo-file-system", () => ({ Directory: class {}, File: class {}, Paths: {} }));
const flushAllQueuedSends = vi.hoisted(() => vi.fn(async () => undefined));
const flushAllPendingOps = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./chat-send", () => ({ chatSendDeps: { name: "sends" }, flushAllQueuedSends }));
vi.mock("./pending-ops", () => ({ pendingOpsDeps: { name: "ops" }, flushAllPendingOps }));

import { flushOwed } from "./owed";
import { REMOTE_CONFIG_FALLBACK, remoteConfigKey } from "./remote-config";

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

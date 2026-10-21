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

describe("flushOwed", () => {
  it("flushes the sends and the queued ops of every workspace for the person, with the app's wiring by default", async () => {
    const qc = new QueryClient();
    await flushOwed(qc, "u1");
    expect(flushAllQueuedSends).toHaveBeenCalledWith(qc, "u1", { name: "sends" });
    expect(flushAllPendingOps).toHaveBeenCalledWith(qc, "u1", { name: "ops" });
  });
});

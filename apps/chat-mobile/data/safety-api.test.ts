// Block and report: the request each sends, what it reads, and that a
// malformed answer degrades instead of throwing.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({ api: { request: vi.fn(async () => ({ status: "ok" })) } }));

import { api } from "./api";
import { createSafetyApi, safetyApi } from "./safety-api";

const request = vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>();
const safety = createSafetyApi(request);
const U = "/api/v1/workspaces/w%201/chat/users/u1/block";

beforeEach(() => request.mockReset());

describe("safety endpoints", () => {
  it("blockStatus reads both directions", async () => {
    request.mockResolvedValueOnce({ blocked_by_me: true, blocked_me: false });
    await expect(safety.blockStatus("w 1", "u1")).resolves.toEqual({ blocked_by_me: true, blocked_me: false });
    expect(request).toHaveBeenCalledWith(U, { signal: undefined });
  });

  it("block and unblock answer whether the server said ok", async () => {
    request.mockResolvedValueOnce({ status: "ok" });
    await expect(safety.block("w 1", "u1")).resolves.toBe(true);
    // The web's request (core's chat-users-api): an empty JSON body.
    expect(request).toHaveBeenLastCalledWith(U, { method: "POST", body: "{}" });
    request.mockResolvedValueOnce({ status: "ok" });
    await expect(safety.unblock("w 1", "u1")).resolves.toBe(true);
    expect(request).toHaveBeenLastCalledWith(U, { method: "DELETE" });
  });

  it("report posts the body and reads the receipt", async () => {
    request.mockResolvedValueOnce({ id: "rep1", status: "open" });
    await expect(safety.report("w 1", { message_id: "m1", reason: "spam" })).resolves.toEqual({ id: "rep1", status: "open" });
    expect(request).toHaveBeenCalledWith("/api/v1/workspaces/w%201/chat/reports", { method: "POST", body: JSON.stringify({ message_id: "m1", reason: "spam" }) });
    request.mockResolvedValueOnce({ id: "rep2", status: 3 });
    await expect(safety.report("w 1", { user_id: "u1", reason: "other" })).resolves.toEqual({ id: "rep2", status: "open" });
  });

  it.each([null, "x", [], { id: 7 }])("a malformed answer (%j) degrades: not blocked, not ok, no receipt", async (raw) => {
    request.mockResolvedValue(raw);
    await expect(safety.blockStatus("w", "u")).resolves.toEqual({ blocked_by_me: false, blocked_me: false });
    await expect(safety.block("w", "u")).resolves.toBe(false);
    await expect(safety.unblock("w", "u")).resolves.toBe(false);
    await expect(safety.report("w", { user_id: "u", reason: "spam" })).resolves.toBeNull();
  });

  it("the app's instance goes through the shared transport", async () => {
    await safetyApi.block("w1", "u1");
    expect(api.request).toHaveBeenCalledWith("/api/v1/workspaces/w1/chat/users/u1/block", { method: "POST", body: "{}" });
  });
});

import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safetyApi = vi.hoisted(() => ({ blockStatus: vi.fn(async () => ({ blocked_by_me: true, blocked_me: false })), block: vi.fn(async () => true), unblock: vi.fn(async () => true) }));
vi.mock("../safety-api", () => ({ safetyApi }));

import { blockStatusOptions, setBlocked } from "./safety";

beforeEach(() => vi.clearAllMocks());

describe("block status", () => {
  it("is keyed under the workspace's chat and asks the API", async () => {
    const qc = new QueryClient();
    const options = blockStatusOptions("w1", "u1");
    expect(options.queryKey).toEqual(["chat", "w1", "block", "u1"]);
    await expect(qc.fetchQuery(options)).resolves.toEqual({ blocked_by_me: true, blocked_me: false });
    expect(safetyApi.blockStatus).toHaveBeenCalledWith("w1", "u1", expect.any(AbortSignal));
    expect(blockStatusOptions("", "u1").enabled).toBe(false);
  });

  it("a block or an unblock refreshes the status and the room list", async () => {
    const qc = { invalidateQueries: vi.fn(async (_filters?: { queryKey?: unknown }) => undefined) };
    await setBlocked(qc, "w1", "u1", true);
    expect(safetyApi.block).toHaveBeenCalledWith("w1", "u1");
    await setBlocked(qc, "w1", "u1", false);
    expect(safetyApi.unblock).toHaveBeenCalledWith("w1", "u1");
    expect(qc.invalidateQueries.mock.calls.map(([arg]) => arg?.queryKey)).toEqual([
      ["chat", "w1", "block", "u1"],
      ["chat", "w1", "rooms"],
      ["chat", "w1", "block", "u1"],
      ["chat", "w1", "rooms"],
    ]);
  });

  it("rejects when the server did not say ok, after refreshing anyway", async () => {
    const qc = { invalidateQueries: vi.fn(async (_filters?: { queryKey?: unknown }) => undefined) };
    safetyApi.block.mockResolvedValueOnce(false);
    await expect(setBlocked(qc, "w1", "u1", true)).rejects.toThrow("block refused");
    safetyApi.unblock.mockResolvedValueOnce(false);
    await expect(setBlocked(qc, "w1", "u1", false)).rejects.toThrow("unblock refused");
    expect(qc.invalidateQueries).toHaveBeenCalledTimes(4);
  });
});

import { beforeEach, describe, expect, it, vi } from "vitest";

const safetyApi = vi.hoisted(() => ({ block: vi.fn(async () => true), unblock: vi.fn(async () => true) }));
vi.mock("./safety-api", () => ({ safetyApi }));

import { setBlocked } from "./safety-actions";

beforeEach(() => vi.clearAllMocks());

describe("setBlocked", () => {
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

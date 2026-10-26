import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safetyApi = vi.hoisted(() => ({ blockStatus: vi.fn(async () => ({ blocked_by_me: true, blocked_me: false })), block: vi.fn(async () => true), unblock: vi.fn(async () => true) }));
vi.mock("../safety-api", () => ({ safetyApi }));

import { blockStatusOptions } from "./safety";

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
});

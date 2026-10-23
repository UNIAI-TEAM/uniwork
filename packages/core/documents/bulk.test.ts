import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { DocumentNotVerifiableError } from "../types/document";
import { bulkErrorCode, runBulk } from "./bulk";

// UNI-2045 W9: the batch runner behind every bulk command. It fans one call
// out per document, never more than four at once, keeps going past a refusal
// and retries a rate-limited call once.

const ids = (n: number) => Array.from({ length: n }, (_, i) => `d${i + 1}`);
const noWait = () => Promise.resolve();

describe("runBulk", () => {
  it("never runs more than four calls at once, even when asked for more", async () => {
    let inFlight = 0;
    let peak = 0;
    const fn = async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 1));
      inFlight -= 1;
    };
    const result = await runBulk(ids(11), fn, { concurrency: 8, wait: noWait });
    expect(peak).toBe(4);
    expect(result.ok).toHaveLength(11);
  });

  it("keeps going past a 403 and a 409, and counts each outcome once", async () => {
    const fn = vi.fn(async (id: string) => {
      if (id === "d2") throw new ApiError("no", "forbidden", 403);
      if (id === "d4") throw new ApiError("busy", "document_conflict", 409);
    });
    const result = await runBulk(ids(5), fn, { wait: noWait });
    expect(result).toEqual({
      ok: ["d1", "d3", "d5"],
      failed: [
        { id: "d2", code: "forbidden" },
        { id: "d4", code: "conflict" },
      ],
    });
    expect(fn).toHaveBeenCalledTimes(5);
  });

  it("retries a 429 once, waiting what the server asked, then gives up", async () => {
    const wait = vi.fn(noWait);
    const calls = new Map<string, number>();
    const fn = async (id: string) => {
      const n = (calls.get(id) ?? 0) + 1;
      calls.set(id, n);
      if (id === "d1" && n === 1) throw new ApiError("slow down", "rate_limited", 429, undefined, undefined, undefined, 2);
      if (id === "d2") throw new ApiError("slow down", "rate_limited", 429);
    };
    const result = await runBulk(ids(3), fn, { wait });
    expect(result.ok).toEqual(["d1", "d3"]);
    expect(result.failed).toEqual([{ id: "d2", code: "rate_limited" }]);
    expect(calls.get("d1")).toBe(2);
    expect(calls.get("d2")).toBe(2);
    expect(calls.get("d3")).toBe(1);
    expect(wait).toHaveBeenCalledWith(2000);
  });

  it("answers the same shape for an empty batch", async () => {
    await expect(runBulk([], vi.fn(), { wait: noWait })).resolves.toEqual({ ok: [], failed: [] });
  });
});

describe("bulkErrorCode", () => {
  it("names the refusal classes and keeps any other server code", () => {
    expect(bulkErrorCode(new ApiError("x", "", 401))).toBe("forbidden");
    expect(bulkErrorCode(new ApiError("x", "document_not_found", 404))).toBe("not_found");
    expect(bulkErrorCode(new ApiError("x", "folder_too_large", 422))).toBe("folder_too_large");
    expect(bulkErrorCode(new ApiError("x", "", 500))).toBe("failed");
    expect(bulkErrorCode(new DocumentNotVerifiableError())).toBe("not_verifiable");
    expect(bulkErrorCode(new Error("boom"))).toBe("failed");
  });
});

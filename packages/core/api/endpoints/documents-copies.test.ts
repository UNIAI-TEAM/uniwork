import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { copyDocument } from "./documents-copies";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const document = (over: Record<string, unknown> = {}) => ({
  id: "d2",
  workspace_id: "ws1",
  kind: "file",
  title: "Kế hoạch Q4 (bản sao)",
  revision: "1",
  current_version: 1,
  created_at: "2026-09-28T03:00:00Z",
  updated_at: "2026-09-28T03:00:00Z",
  ...over,
});

describe("documents-copies endpoint", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("posts consent and the optional title with the idempotency key", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: document() }, 201));
    const out = await copyDocument(
      "d1",
      { consent: "copy", title: "Kế hoạch Q4 (bản sao)" },
      { idempotencyKey: "key-1" },
    );

    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(
      "http://api.test/api/v1/documents/d1/copies",
    );
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ consent: "copy", title: "Kế hoạch Q4 (bản sao)" });
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe("key-1");
    expect(out?.id).toBe("d2");
  });

  it("degrades to null on a malformed answer instead of inventing a copy", async () => {
    for (const body of [{ nope: true }, { document: "x" }, null, [], "str"]) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body, 201));
      const out = await copyDocument("d1", { consent: "copy" });
      expect(out).toBeNull();
    }
  });
});

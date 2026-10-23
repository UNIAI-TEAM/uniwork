import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { copyDocument } from "./office";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const docBody = (over: Record<string, unknown> = {}) => ({
  id: "d2",
  organization_id: "o1",
  workspace_id: "w1",
  parent_id: null,
  kind: "file",
  title: "Ghi chú",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-09-28T09:00:00Z",
  updated_at: "2026-09-28T09:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { document: "x" }, null, [], "str"];

describe("office endpoints", () => {
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

  it("copyDocument posts the consent with the idempotency header and returns the copy", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ id: "d3" }) }));
    const copy = await copyDocument("d1", { consent: "copy", title: "Bản sao" }, { idempotencyKey: "k" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/copies");
    expect(JSON.parse(String(init?.body))).toEqual({ consent: "copy", title: "Bản sao" });
    expect(new Headers(init?.headers).get("Idempotency-Key")).toBe("k");
    expect(copy?.id).toBe("d3");
  });

  it("degrades to null on a malformed body", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect(await copyDocument("d1", { consent: "copy" })).toBeNull();
    }
  });

  it("a refused copy surfaces instead of a fabricated document", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "copy_consent_required", message: "consent" } }, 400));
    await expect(copyDocument("d1", { consent: "copy" })).rejects.toThrow();
  });

  it("copyDocument forwards upload_id alongside consent and title when saving a conflict copy", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document: docBody({ id: "d4", title: "Bản sao (2)" }) }));
    const copy = await copyDocument("d1", { consent: "copy", upload_id: "up-1", title: "Bản sao (2)" }, { idempotencyKey: "k2" });
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ consent: "copy", upload_id: "up-1", title: "Bản sao (2)" });
    expect(copy?.id).toBe("d4");
  });
});

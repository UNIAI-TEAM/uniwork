import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { createSavedSignature, deleteSavedSignature, listSavedSignatures } from "./signatures";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const signatureBody = (over: Record<string, unknown> = {}) => ({
  id: "01K6SIGN1P2Q3R4S5T6U7V8YA",
  label: "Chữ ký của tôi",
  content_type: "image/png",
  image: "iVBORw0KGgo=",
  byte_size: 8,
  created_at: "2026-10-03T08:00:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { signatures: "x" }, null, [], "str"];

describe("saved signature endpoints", () => {
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

  it("listSavedSignatures reads the organization route", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ signatures: [signatureBody()] }));
    const out = await listSavedSignatures("o1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/o1/signatures");
    expect(init?.method).toBe("GET");
    expect(out).toHaveLength(1);
    expect(out[0]?.label).toBe("Chữ ký của tôi");
    expect(out[0]?.content_type).toBe("image/png");
  });

  it("createSavedSignature POSTs the base64 body and reads the stored row", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ signature: signatureBody() }, 201));
    const out = await createSavedSignature("o1", {
      label: "Chữ ký của tôi",
      contentType: "image/png",
      image: "iVBORw0KGgo=",
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/o1/signatures");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      label: "Chữ ký của tôi",
      content_type: "image/png",
      image: "iVBORw0KGgo=",
    });
    expect(out?.id).toBe("01K6SIGN1P2Q3R4S5T6U7V8YA");
  });

  it("deleteSavedSignature DELETEs the row route and proves the status", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ status: "ok" }));
    const ok = await deleteSavedSignature("o1", "s1");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/orgs/o1/signatures/s1");
    expect(init?.method).toBe("DELETE");
    expect(ok).toBe(true);
  });

  it("degrades a malformed list to []", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(listSavedSignatures("o1")).resolves.toEqual([]);
    }
  });

  it("a malformed save is null and a malformed delete is unproven", async () => {
    for (const body of malformedBodies) {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(
        createSavedSignature("o1", { label: "x", contentType: "image/png", image: "i" }),
      ).resolves.toBeNull();
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(deleteSavedSignature("o1", "s1")).resolves.toBe(false);
    }
  });
});

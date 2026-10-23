import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { transferDocumentOwner } from "./documents-owner";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

// DocumentOwnerSDO, access addendum §4.2 (W-DOC06, UNI-1630).
const ownerBody = (over: Record<string, unknown> = {}) => ({
  document_id: "d1",
  acl_owner_id: "u3",
  previous_owner_id: "u1",
  previous_owner_share_id: "s9",
  ...over,
});

const malformedBodies = [{ nope: true }, { document_id: 7 }, { acl_owner_id: null }, null, [], "str"];

describe("documents-owner endpoints", () => {
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

  it("transferDocumentOwner PUTs the new owner and the previous owner's level", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(ownerBody()));
    const out = await transferDocumentOwner("d1", { user_id: "u3", previous_owner_level: "edit" });
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(String(url)).toBe("http://api.test/api/v1/documents/d1/owner");
    expect(init?.method).toBe("PUT");
    expect(JSON.parse(String(init?.body))).toEqual({ user_id: "u3", previous_owner_level: "edit" });
    expect(out).toEqual(ownerBody());
  });

  it("transferDocumentOwner reads an empty share id (previous owner kept nothing)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(ownerBody({ previous_owner_share_id: "" })));
    const out = await transferDocumentOwner("d1", { user_id: "u3", previous_owner_level: "none" });
    expect(out?.previous_owner_share_id).toBe("");
  });

  it("transferDocumentOwner tolerates a missing share id and previous owner", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ document_id: "d1", acl_owner_id: "u3" }));
    const out = await transferDocumentOwner("d1", { user_id: "u3" });
    expect(out).toEqual({ document_id: "d1", acl_owner_id: "u3", previous_owner_id: "", previous_owner_share_id: "" });
  });

  it.each(malformedBodies)("transferDocumentOwner degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(transferDocumentOwner("d1", { user_id: "u3" })).resolves.toBeNull();
  });
});

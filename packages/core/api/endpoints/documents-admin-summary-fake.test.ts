// FAKE until DOC-05 (b) lands: delete with documents-admin-summary-fake.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { getDocumentAdminSummaryFake } from "./documents-admin-summary-fake";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const summary = {
  id: "d1",
  title: "Kế hoạch Q4",
  kind: "page",
  visibility: "restricted",
  organization_id: "o1",
  revision: "7",
  acl_owner: { user_id: "u2" },
};

describe("documents admin-summary (fake)", () => {
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

  it("reads the metadata, bare or enveloped", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(summary)).mockResolvedValueOnce(json({ summary }));
    const bare = await getDocumentAdminSummaryFake("d1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe("http://api.test/api/v1/documents/d1/admin-summary");
    expect(bare).toMatchObject({ id: "d1", visibility: "restricted", acl_owner: { user_id: "u2" } });
    expect(await getDocumentAdminSummaryFake("d1")).toMatchObject({ id: "d1", title: "Kế hoạch Q4" });
  });

  it.each([{ nope: true }, { id: 1 }, { summary: null }, null, [], "str"])("degrades %#", async (body) => {
    vi.mocked(fetch).mockResolvedValueOnce(json(body));
    await expect(getDocumentAdminSummaryFake("d1")).resolves.toBeNull();
  });
});

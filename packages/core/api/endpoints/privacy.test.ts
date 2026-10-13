import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { cancelPrivacyDeletion, createPrivacyExport, createPrivacyDeletion, listPrivacyExports } from "./privacy";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validExport = {
  id: "e1",
  status: "done",
  row_count: 12,
  created_at: "2026-10-12T02:00:00Z",
  download_url: "/api/v1/orgs/org1/privacy/exports/e1/download",
  expires_at: "2026-10-13T02:00:00Z",
};

describe("privacy export endpoints", () => {
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

  it("listPrivacyExports returns the jobs", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ exports: [validExport] }));
    const jobs = await listPrivacyExports("org1");
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.id).toBe("e1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/orgs/org1/privacy/exports");
  });

  it("listPrivacyExports returns [] on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ exports: [{ id: 7 }] }));
    await expect(listPrivacyExports("org1")).resolves.toEqual([]);
  });

  it("createPrivacyExport posts and returns the job", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ export: { ...validExport, status: "pending" } }, 202));
    const job = await createPrivacyExport("org1");
    expect(job?.status).toBe("pending");
    const init = vi.mocked(fetch).mock.calls[0]![1];
    expect(init?.method).toBe("POST");
  });

  it("createPrivacyExport returns null on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ export: { status: "pending" } }));
    await expect(createPrivacyExport("org1")).resolves.toBeNull();
  });

  it("createPrivacyDeletion returns null on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ export: { confirm_slug: "acme" } }));
    await expect(createPrivacyDeletion("org1", "acme")).resolves.toBeNull();
  });

  it("cancelPrivacyDeletion returns null on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ export: { status: 1 } }));
    await expect(cancelPrivacyDeletion("org1")).resolves.toBeNull();
  });
});

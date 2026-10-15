import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { getMemberDocumentOwnership, transferMemberDocuments } from "./organization-document-ownership";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const URL_PATH = "/api/v1/orgs/acme/members/u%2F1/document-ownership";

describe("organization document ownership endpoints", () => {
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

  it("getMemberDocumentOwnership reads the per-workspace counts from the slug path", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        user_id: "u/1",
        total: 5,
        workspaces: [
          { workspace_id: "w1", workspace_name: "Kinh doanh", count: 3 },
          { workspace_id: "w2", count: 2 },
        ],
      }),
    );
    const out = await getMemberDocumentOwnership("acme", "u/1");
    expect(String(vi.mocked(fetch).mock.calls[0]![0])).toBe(`http://api.test${URL_PATH}`);
    expect(out).toEqual({
      user_id: "u/1",
      total: 5,
      workspaces: [
        { workspace_id: "w1", workspace_name: "Kinh doanh", count: 3 },
        { workspace_id: "w2", workspace_name: "", count: 2 },
      ],
    });
  });

  it("getMemberDocumentOwnership degrades to null, never to zero, on a malformed response", async () => {
    // Zero would hide the transfer step; null reads as "could not count".
    vi.mocked(fetch).mockResolvedValueOnce(json({ total: "many", workspaces: [{ count: "x" }] }));
    await expect(getMemberDocumentOwnership("acme", "u/1")).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json("nope"));
    await expect(getMemberDocumentOwnership("acme", "u/1")).resolves.toBeNull();
  });

  it("transferMemberDocuments posts the recipient, and bulk_id + cursor only when given", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        bulk_id: "b1",
        transferred: 497,
        skipped: { recipient_not_member: 3, self_restricted: 0 },
        has_more: true,
        cursor: "c1",
      }),
    );
    const first = await transferMemberDocuments("acme", "u/1", { to_user_id: "u2" });
    expect(first).toEqual({
      bulk_id: "b1",
      transferred: 497,
      skipped: { recipient_not_member: 3, self_restricted: 0 },
      has_more: true,
      cursor: "c1",
    });
    const init1 = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    expect(init1.method).toBe("POST");
    expect(JSON.parse(String(init1.body))).toEqual({ to_user_id: "u2" });

    vi.mocked(fetch).mockResolvedValueOnce(
      json({ bulk_id: "b1", transferred: 12, skipped: {}, has_more: false, cursor: "" }),
    );
    const next = await transferMemberDocuments("acme", "u/1", { to_user_id: "u2", bulk_id: "b1", cursor: "c1" });
    expect(next?.skipped).toEqual({ recipient_not_member: 0, self_restricted: 0 });
    const init2 = vi.mocked(fetch).mock.calls[1]![1] as RequestInit;
    expect(JSON.parse(String(init2.body))).toEqual({ to_user_id: "u2", bulk_id: "b1", cursor: "c1" });
  });

  it("transferMemberDocuments degrades to null on a malformed response", async () => {
    // has_more is load-bearing: a guess would stop the loop early or never.
    vi.mocked(fetch).mockResolvedValueOnce(json({ transferred: 3, skipped: {} }));
    await expect(transferMemberDocuments("acme", "u/1", { to_user_id: "u2" })).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ transferred: "3", has_more: false }));
    await expect(transferMemberDocuments("acme", "u/1", { to_user_id: "u2" })).resolves.toBeNull();
  });
});

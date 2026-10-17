import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import { ApiError } from "../http";
import {
  getDocumentShares,
  listShareCandidates,
  parseDocumentAccessRejected,
  updateDocumentAccess,
} from "./documents-sharing";

// F-W1-05: response enums are z.string(); a value a newer server adds must not
// fail the parse of a write that already committed.

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

describe("documents-sharing lenient response enums (F-W1-05)", () => {
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

  it("updateDocumentAccess keeps the whole answer when a status, warning code or group type is new", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        batch_id: "01JB",
        dry_run: false,
        results: [
          { index: 0, status: "granted" },
          { index: 1, status: "quarantined" },
        ],
        preview: {
          users: [],
          groups: [{ principal_type: "team", principal_id: "t1", member_count: 4, losing_count: 1 }],
          warnings: [
            { code: "wide_scope", index: 0 },
            { code: "needs_review", index: 1 },
          ],
        },
      }),
    );
    const out = await updateDocumentAccess("d1", {
      items: [{ principal_type: "user", principal_id: "u2", level: "view" }],
    });
    expect(out).not.toBeNull();
    expect(out?.results.map((r) => r.status)).toEqual(["granted", "quarantined"]);
    expect(out?.preview.warnings.map((w) => w.code)).toEqual(["wide_scope", "needs_review"]);
    expect(out?.preview.groups[0]?.member_count).toBe(4);
  });

  it("the dry_run preview carries no group name: the schema neither requires nor invents one (R1-12)", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        results: [{ index: 0, status: "granted" }],
        preview: { users: [], groups: [{ principal_type: "workspace", principal_id: "w1", member_count: 2, losing_count: 0 }], warnings: [] },
      }),
    );
    const out = await updateDocumentAccess("d1", {
      items: [{ principal_type: "workspace", principal_id: "w1", level: "view" }],
      dry_run: true,
    });
    expect(out?.preview.groups).toEqual([
      { principal_type: "workspace", principal_id: "w1", member_count: 2, losing_count: 0 },
    ]);
  });

  it("listShareCandidates narrows an unknown direct_level to null and drops only a principal type it cannot share with", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        items: [
          { principal_type: "user", principal_id: "u2", name: "An", direct_level: "super_edit" },
          { principal_type: "agent", principal_id: "a1", name: "Bot" },
          { principal_type: "workspace", principal_id: "w1", name: "Kinh doanh", direct_level: "edit" },
        ],
        next_cursor: "",
      }),
    );
    const out = await listShareCandidates("d1");
    expect(out.items.map((c) => c.principal_id)).toEqual(["u2", "w1"]);
    expect(out.items[0]?.direct_level).toBeNull();
    expect(out.items[1]?.direct_level).toBe("edit");
  });

  it("parseDocumentAccessRejected keeps a rejected item whose code is new", () => {
    const err = new ApiError("rejected", "document_access_rejected", 422, undefined, {
      rejected: [{ index: 0, principal_type: "user", principal_id: "u9", code: "quota_exceeded" }],
    });
    expect(parseDocumentAccessRejected(err)?.rejected).toEqual([
      { index: 0, principal_type: "user", principal_id: "u9", code: "quota_exceeded" },
    ]);
  });

  it("getDocumentShares keeps the overview and narrows an unknown home workspace level to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        my_level: "manage",
        via: "member",
        home_workspace: { workspace_id: "w1", workspace_name: "Kinh doanh", level: "super_edit" },
      }),
    );
    const out = await getDocumentShares("d1");
    expect(out?.home_workspace?.workspace_id).toBe("w1");
    expect(out?.home_workspace?.level).toBeNull();
  });
});

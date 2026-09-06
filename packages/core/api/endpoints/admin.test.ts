import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  changeOrganizationPlan,
  deleteFlagOverride,
  getAdminMe,
  getAdminOrganization,
  getAdminSystem,
  getAdminTrace,
  listAdminFlags,
  listAdminOrganizations,
  listFlagOverrides,
  setFlagOverride,
  suspendOrganization,
  unsuspendOrganization,
} from "./admin";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const org = {
  id: "o1", slug: "acme", name: "Acme", status: "active", plan_code: "free",
  member_count: 3, workspace_count: 1, created_at: "2026-09-01T00:00:00Z", last_activity_at: null,
};
const action = {
  id: "a1", actor_id: "u1", action: "organization.suspended", target_type: "organization", target_id: "o1",
  before: { status: "active" }, after: { status: "suspended" }, reason: "Chưa thanh toán hóa đơn", trace_id: "t1",
  created_at: "2026-09-06T00:00:00Z",
};
const override = {
  id: "f1", flag_key: "agents_assignee", scope_type: "global", scope_id: "", enabled: true, note: "",
  created_by: "u1", created_at: "2026-09-06T00:00:00Z", expires_at: "",
};

describe("admin endpoints", () => {
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

  it("getAdminMe returns the role, '' when malformed, and throws on 404", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ platform_role: "support" }));
    expect(await getAdminMe()).toBe("support");
    vi.mocked(fetch).mockResolvedValueOnce(json({ role: 1 }));
    expect(await getAdminMe()).toBe("");
    vi.mocked(fetch).mockResolvedValueOnce(json({ error: "not_found" }, 404));
    await expect(getAdminMe()).rejects.toMatchObject({ status: 404 });
  });

  it("listAdminOrganizations builds the query string and degrades to []", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ organizations: [{ ...org, status: "mystery" }] }));
    const rows = await listAdminOrganizations({ q: "ac me", status: "active", limit: 20, offset: 40 });
    expect(rows[0]!.status).toBe("mystery");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/admin/organizations?q=ac+me&status=active&limit=20&offset=40",
    );
    vi.mocked(fetch).mockResolvedValueOnce(json({ organizations: [{ id: 1 }] }));
    await expect(listAdminOrganizations()).resolves.toEqual([]);
    expect(vi.mocked(fetch).mock.calls[1]![0]).toBe("http://api.test/api/v1/admin/organizations");
  });

  it("getAdminOrganization fills optional lists and returns null when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization: org, entitlements: [{ key: "members", kind: "quota", enabled: true, limit: 50, current: 3 }] }));
    const detail = await getAdminOrganization("o1");
    expect(detail?.actions).toEqual([]);
    expect(detail?.entitlements[0]!.limit).toBe(50);
    expect(detail?.suspended_at).toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization: { id: "o1" } }));
    await expect(getAdminOrganization("o1")).resolves.toBeNull();
  });

  it("suspend/unsuspend send the reason and degrade to null", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization: { ...org, status: "suspended" } }));
    expect((await suspendOrganization("o1", "Chưa thanh toán"))?.status).toBe("suspended");
    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("http://api.test/api/v1/admin/organizations/o1/suspend");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ reason: "Chưa thanh toán" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization: 3 }));
    await expect(suspendOrganization("o1", "x")).resolves.toBeNull();
    vi.mocked(fetch).mockResolvedValueOnce(json({ organization: org }));
    expect((await unsuspendOrganization("o1", "Đã thanh toán"))?.status).toBe("active");
    expect(vi.mocked(fetch).mock.calls[2]![0]).toBe("http://api.test/api/v1/admin/organizations/o1/unsuspend");
    vi.mocked(fetch).mockResolvedValueOnce(json([]));
    await expect(unsuspendOrganization("o1", "x")).resolves.toBeNull();
  });

  it("changeOrganizationPlan returns the subscription and null when malformed", async () => {
    const subscription = {
      id: "s1", plan_code: "team", plan_name: "Team", status: "active", provider: "manual",
      current_period_start: "2026-09-06T00:00:00Z", row_version: 2,
    };
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscription, entitlements: [] }));
    expect((await changeOrganizationPlan("o1", { plan_code: "team", reason: "Pilot đối tác" }))?.plan_code).toBe("team");
    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual({ plan_code: "team", reason: "Pilot đối tác" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscription: { id: 1 } }));
    await expect(changeOrganizationPlan("o1", { plan_code: "team", reason: "x" })).resolves.toBeNull();
  });

  it("getAdminTrace keeps rows it understands and returns null when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      trace_id: "t1",
      audit: [{ id: "e1", action: "task.updated", occurred_at: "2026-09-06T00:00:01Z" }],
      outbox: [{ id: "x1", topic: "task.updated", created_at: "2026-09-06T00:00:02Z", status: "DONE" }],
      actions: [action],
    }));
    const trace = await getAdminTrace("t1");
    expect(trace?.audit[0]!.actor_kind).toBe("");
    expect(trace?.outbox[0]!.attempts).toBe(0);
    expect(trace?.actions[0]!.after).toEqual({ status: "suspended" });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/admin/trace/t1");
    vi.mocked(fetch).mockResolvedValueOnce(json({ audit: "nope" }));
    await expect(getAdminTrace("t1")).resolves.toBeNull();
  });

  it("getAdminSystem defaults missing sections and returns null when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      version: "1.4.0", readiness: { ready: true, checks: [{ name: "db", ok: true }] }, outbox_pending: 3, flag_providers: ["db", "static"],
    }));
    const system = await getAdminSystem();
    expect(system?.readiness.checks[0]!.detail).toBe("");
    expect(system?.outbox_dead).toBe(0);
    expect(system?.flag_providers).toEqual(["db", "static"]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ version: 5 }));
    await expect(getAdminSystem()).resolves.toBeNull();
  });

  it("listAdminFlags degrades to []", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: [{ key: "agents_assignee", default: false }] }));
    expect((await listAdminFlags())[0]!.override_count).toBe(0);
    vi.mocked(fetch).mockResolvedValueOnce(json({ flags: [{ key: 1 }] }));
    await expect(listAdminFlags()).resolves.toEqual([]);
  });

  it("override list/set/delete send the right method and degrade to []", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ overrides: [override] }));
    expect((await listFlagOverrides("agents_assignee"))[0]!.enabled).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/admin/flags/agents_assignee/overrides");
    vi.mocked(fetch).mockResolvedValueOnce(json({ overrides: [override] }));
    const body = { scope_type: "global" as const, scope_id: "", enabled: true, reason: "Bật thử cho pilot" };
    expect(await setFlagOverride("agents_assignee", body)).toHaveLength(1);
    expect(vi.mocked(fetch).mock.calls[1]![1]?.method).toBe("PUT");
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[1]![1]?.body))).toEqual(body);
    vi.mocked(fetch).mockResolvedValueOnce(json({ overrides: [] }));
    expect(await deleteFlagOverride("agents_assignee", { scope_type: "global", scope_id: "", reason: "Hết pilot rồi" })).toEqual([]);
    expect(vi.mocked(fetch).mock.calls[2]![1]?.method).toBe("DELETE");
    vi.mocked(fetch).mockResolvedValueOnce(json({ overrides: [{ id: 1 }] }));
    await expect(listFlagOverrides("k")).resolves.toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ nope: 1 }));
    await expect(setFlagOverride("k", body)).resolves.toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json(null));
    await expect(deleteFlagOverride("k", { scope_type: "global", scope_id: "", reason: "Hết pilot rồi" })).resolves.toEqual([]);
  });
});

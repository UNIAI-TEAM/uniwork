import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  createAuditExport,
  getAuditEvent,
  getAuditExport,
  getAuditRetention,
  listAuditEvents,
  listAuditExports,
  listResourceHistory,
  setAuditRetention,
} from "./audit";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const validEvent = {
  id: "a1",
  organization_id: "org1",
  workspace_id: "ws1",
  actor_kind: "human",
  actor_id: "u1",
  action: "task.updated",
  resource_type: "task",
  resource_id: "t1",
  changes: { status: { from: "todo", to: "done" } },
  metadata: {},
  correlation_id: "corr1",
  occurred_at: "2026-09-04T09:00:00Z",
};

const validExport = {
  id: "e1",
  format: "csv",
  from_at: "2026-08-01T00:00:00Z",
  to_at: "2026-09-01T00:00:00Z",
  status: "done",
  row_count: 12,
  created_at: "2026-09-04T09:00:00Z",
};

/**
 * The audit screen is the one a compliance officer opens after something went
 * wrong, so it degrades rather than blanks: every endpoint here is checked
 * against a well-formed response, a malformed one, and a value this client
 * predates.
 */
describe("audit endpoints", () => {
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

  it("listAuditEvents returns the page and its cursor", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ events: [validEvent], next_before: "a1" }));
    const page = await listAuditEvents("org1", { action: "task.updated", limit: 50 });
    expect(page.events).toHaveLength(1);
    expect(page.nextBefore).toBe("a1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/orgs/org1/audit?action=task.updated&limit=50",
    );
  });

  it("listAuditEvents drops empty filters from the query string", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ events: [], next_before: "" }));
    await listAuditEvents("org1", { actor_id: "", action: undefined });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe("http://api.test/api/v1/orgs/org1/audit");
  });

  it("listAuditEvents returns an empty page instead of throwing on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ events: [{ id: 7 }] }));
    await expect(listAuditEvents("org1")).resolves.toEqual({ events: [], nextBefore: "" });
  });

  it("listAuditEvents lets an actor kind this client predates through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ events: [{ ...validEvent, actor_kind: "swarm" }], next_before: "" }),
    );
    const page = await listAuditEvents("org1");
    expect(page.events[0]!.actor_kind).toBe("swarm");
  });

  it("getAuditEvent returns null on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ event: { id: 1 } }));
    await expect(getAuditEvent("org1", "a1")).resolves.toBeNull();
  });

  it("getAuditEvent returns the row when it is well formed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ event: validEvent }));
    await expect(getAuditEvent("org1", "a1")).resolves.toMatchObject({ action: "task.updated" });
  });

  it("listResourceHistory returns [] on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ events: "nope" }));
    await expect(listResourceHistory("ws1", "task", "t1")).resolves.toEqual([]);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/workspaces/ws1/resources/task/t1/history",
    );
  });

  it("getAuditRetention falls back to the documented default", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ retain_days: "a lot" }));
    await expect(getAuditRetention("org1")).resolves.toBe(90);
  });

  it("setAuditRetention echoes the requested value when the response drifts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({}));
    await expect(setAuditRetention("org1", 180)).resolves.toBe(180);
  });

  it("listAuditExports returns [] on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ exports: [{ id: 1 }] }));
    await expect(listAuditExports("org1")).resolves.toEqual([]);
  });

  it("createAuditExport returns the queued job", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ export: { ...validExport, status: "pending" } }, 202));
    await expect(
      createAuditExport("org1", { format: "csv", from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }),
    ).resolves.toMatchObject({ status: "pending" });
  });

  it("createAuditExport returns null instead of throwing on a malformed response", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ export: { id: 1 } }, 202));
    await expect(
      createAuditExport("org1", { format: "csv", from: "2026-08-01T00:00:00Z", to: "2026-09-01T00:00:00Z" }),
    ).resolves.toBeNull();
  });

  it("getAuditExport lets a status this client predates through", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ export: { ...validExport, status: "archived" } }));
    await expect(getAuditExport("org1", "e1")).resolves.toMatchObject({ status: "archived" });
  });
});

describe("correlation id", () => {
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

  it("sends a header the server will accept as-is", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ events: [], next_before: "" }));
    await listAuditEvents("org1");
    const init = vi.mocked(fetch).mock.calls[0]![1] as RequestInit;
    const sent = (init.headers as Record<string, string>)["X-Correlation-ID"];
    // The server replaces anything outside this shape, which would break the
    // trace silently — so the client must generate a value that matches.
    expect(sent).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
  });

  it("puts the failed request's correlation id on the error", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(JSON.stringify({ error: { code: "forbidden", message: "no" } }), {
        status: 403,
        headers: { "Content-Type": "application/json", "X-Correlation-ID": "corr-from-server" },
      }),
    );
    await expect(listAuditEvents("org1")).rejects.toMatchObject({ correlationId: "corr-from-server" });
  });
});

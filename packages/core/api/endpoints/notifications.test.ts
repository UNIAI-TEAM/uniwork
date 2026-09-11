import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  archive,
  getPreferences,
  getPushConfig,
  getUnreadCount,
  listNotifications,
  markAllRead,
  markRead,
  markUnread,
  setPreferences,
  subscribePush,
  unsubscribePush,
} from "./notifications";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const row = {
  id: "n1", kind: "task_assigned", workspace_id: "ws1", organization_id: "o1",
  resource_type: "task", resource_id: "t1", actor_kind: "human", actor_id: "u1",
  title_key: "notifications.kind.task_assigned", params: { actor: "An", task: "Spec" }, count: 1,
  created_at: "2026-09-06T08:00:00Z",
};

describe("notification endpoints", () => {
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

  it("listNotifications builds the query, lets an unknown kind through, and degrades to an empty page", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ notifications: [{ ...row, kind: "mystery" }], next_before: "n1" }));
    const page = await listNotifications({ workspaceId: "ws1", unreadOnly: true, before: "n9", limit: 10 });
    expect(page.notifications[0]!.kind).toBe("mystery");
    expect(page.notifications[0]!.resource_deleted).toBe(false);
    expect(page.next_before).toBe("n1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toBe(
      "http://api.test/api/v1/me/notifications?workspace_id=ws1&unread=1&before=n9&limit=10",
    );
    vi.mocked(fetch).mockResolvedValueOnce(json({ notifications: [{ id: 1 }] }));
    await expect(listNotifications()).resolves.toEqual({ notifications: [], next_before: "" });
  });

  it("getUnreadCount returns totals and zeros when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ total: 3, by_workspace: { ws1: 2 } }));
    expect(await getUnreadCount()).toEqual({ total: 3, by_workspace: { ws1: 2 } });
    vi.mocked(fetch).mockResolvedValueOnce(json({ total: "many" }));
    expect(await getUnreadCount()).toEqual({ total: 0, by_workspace: {} });
  });

  it("markRead, markAllRead, markUnread and archive post the right bodies", async () => {
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    await markRead(["n1"]);
    await markAllRead("ws1");
    await markAllRead();
    await markUnread(["n1"]);
    await archive(["n1", "n2"]);
    const bodies = vi.mocked(fetch).mock.calls.map((c) => [c[0], JSON.parse(String((c[1] as RequestInit).body))]);
    expect(bodies).toEqual([
      ["http://api.test/api/v1/me/notifications/read", { ids: ["n1"] }],
      ["http://api.test/api/v1/me/notifications/read", { all: true, workspace_id: "ws1" }],
      ["http://api.test/api/v1/me/notifications/read", { all: true }],
      ["http://api.test/api/v1/me/notifications/unread", { ids: ["n1"] }],
      ["http://api.test/api/v1/me/notifications/archive", { ids: ["n1", "n2"] }],
    ]);
  });

  it("preferences round-trip and degrade to []", async () => {
    const pref = { kind: "mentioned", in_app: true, push: true, email: false };
    vi.mocked(fetch).mockResolvedValueOnce(json({ preferences: [pref] }));
    expect(await getPreferences()).toEqual([pref]);
    vi.mocked(fetch).mockResolvedValueOnce(json({ preferences: [pref] }));
    expect(await setPreferences([pref])).toEqual([pref]);
    expect(vi.mocked(fetch).mock.calls[1]![1]?.method).toBe("PUT");
    vi.mocked(fetch).mockResolvedValueOnce(json({ preferences: "no" }));
    await expect(getPreferences()).resolves.toEqual([]);
    vi.mocked(fetch).mockResolvedValueOnce(json(null));
    await expect(setPreferences([pref])).resolves.toEqual([]);
  });

  it("push config, subscribe and unsubscribe", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: true, public_key: "BOr" }));
    expect(await getPushConfig()).toEqual({ enabled: true, public_key: "BOr" });
    vi.mocked(fetch).mockResolvedValueOnce(json({ enabled: "yes" }));
    expect(await getPushConfig()).toEqual({ enabled: false, public_key: "" });
    vi.mocked(fetch).mockImplementation(() => Promise.resolve(json({ status: "ok" })));
    await subscribePush({ endpoint: "https://p/x", keys: { p256dh: "p", auth: "a" } });
    await unsubscribePush("https://p/x");
    const [, sub] = vi.mocked(fetch).mock.calls[2]!;
    expect(sub?.method).toBe("POST");
    expect(JSON.parse(String(sub?.body))).toEqual({ endpoint: "https://p/x", keys: { p256dh: "p", auth: "a" } });
    expect(vi.mocked(fetch).mock.calls[3]![1]?.method).toBe("DELETE");
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  getEmailHubThread,
  getEmailHubUnreadCount,
  listEmailHubAccounts,
  listEmailHubThreads,
  patchEmailHubThread,
  cancelEmailHubScheduledSend,
  listEmailHubScheduledSends,
  sendEmailHub,
  getEmailHubThreadSummary,
  summarizeEmailHubThread,
  subscribeEmailHubInboxWatch,
  syncEmailHub,
  unsubscribeEmailHubInboxWatch,
  watchEmailHub,
} from "./email-hub";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const thread = {
  id: "th1",
  account_id: "acc1",
  folder: "SENT",
  subject: "Hello",
  snippet: "Hi there",
  from_addr: "me@gmail.com",
  to_addrs: ["client@example.com"],
  sent_at: "2026-09-18T03:00:00Z",
  is_read: true,
  is_starred: false,
  has_attachments: false,
  body_text: "Hi there",
  body_cached: true,
};

describe("email hub endpoints", () => {
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

  it("listEmailHubAccounts degrades to empty list when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ accounts: [{ id: 1 }] }));
    await expect(listEmailHubAccounts("ws1")).resolves.toEqual({ accounts: [] });
  });

  it("getEmailHubUnreadCount parses count and degrades when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ unread: 3 }));
    await expect(getEmailHubUnreadCount("ws1")).resolves.toEqual({ unread: 3 });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("email-hub/unread-count");

    vi.mocked(fetch).mockResolvedValueOnce(json({ unread: "many" }));
    await expect(getEmailHubUnreadCount("ws1")).resolves.toEqual({ unread: 0 });
  });

  it("sendEmailHub posts the payload and degrades when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(thread, 201));
    const sent = await sendEmailHub("ws1", {
      accountId: "acc1",
      to: ["client@example.com"],
      subject: "Hello",
      bodyText: "Hi there",
      bodyHtml: "<div>Hi there</div>",
      attachments: [{ filename: "note.txt", contentBase64: "aGk=" }],
    });
    expect(sent && "id" in sent ? sent.id : null).toBe("th1");
    const body = String(vi.mocked(fetch).mock.calls[0]![1]?.body);
    expect(body).toContain("body_text");
    expect(body).toContain("body_html");
    expect(body).toContain("content_base64");

    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 1 }, 201));
    await expect(
      sendEmailHub("ws1", {
        accountId: "acc1",
        to: ["client@example.com"],
        subject: "Hello",
        bodyText: "Hi",
      }),
    ).resolves.toBeNull();
  });

  it("sendEmailHub returns scheduled send when server responds with schedule payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json(
        {
          scheduled: true,
          id: "sch1",
          send_at: "2026-09-21T10:00:00Z",
          subject: "Later",
          to: ["client@example.com"],
          account_id: "acc1",
        },
        202,
      ),
    );
    const scheduled = await sendEmailHub("ws1", {
      accountId: "acc1",
      to: ["client@example.com"],
      subject: "Later",
      bodyText: "Hi",
      sendAt: "2026-09-21T10:00:00Z",
    });
    expect(scheduled).toEqual({
      scheduled: true,
      id: "sch1",
      send_at: "2026-09-21T10:00:00Z",
      subject: "Later",
      to: ["client@example.com"],
      account_id: "acc1",
    });
    expect(String(vi.mocked(fetch).mock.calls[0]![1]?.body)).toContain("send_at");
  });

  it("watchEmailHub long-poll response degrades when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ changed: true, synced: true, at: "2026-09-18T04:00:00Z" }));
    expect(await watchEmailHub("ws1", "acc1")).toEqual({
      changed: true,
      synced: true,
      at: "2026-09-18T04:00:00Z",
    });
    vi.mocked(fetch).mockResolvedValueOnce(json({ changed: "yes" }));
    expect(await watchEmailHub("ws1", "acc1")).toEqual({ changed: false, synced: false, at: "" });
  });

  it("inbox-watch subscribe/unsubscribe degrade when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ subscribed: true }));
    expect(await subscribeEmailHubInboxWatch("ws1", "acc1")).toEqual({ subscribed: true });
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("inbox-watch");

    vi.mocked(fetch).mockResolvedValueOnce(json({ subscribed: "yes" }));
    expect(await subscribeEmailHubInboxWatch("ws1", "acc1")).toEqual({ subscribed: false });

    vi.mocked(fetch).mockResolvedValueOnce(json({ subscribed: false }));
    expect(await unsubscribeEmailHubInboxWatch("ws1", "acc1")).toEqual({ subscribed: false });
  });

  it("listEmailHubThreads passes search filters", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ threads: [thread], counts: { total: 1, unread: 0 }, next_cursor: "th2" }),
    );
    const page = await listEmailHubThreads("ws1", "acc1", "INBOX", { q: "hello", unreadOnly: true }, undefined, 25);
    expect(page.next_cursor).toBe("th2");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("q=hello");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("unread=1");
  });

  it("syncEmailHub passes folder query when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ synced: true }));
    const res = await syncEmailHub("ws1", "acc1", "SENT");
    expect(res.synced).toBe(true);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("folder=SENT");
  });

  it("syncEmailHub passes force query when requested", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ synced: true }));
    await syncEmailHub("ws1", "acc1", "INBOX", true);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("force=1");
  });

  it("syncEmailHub passes reconcile query when requested", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ synced: true }));
    await syncEmailHub("ws1", "acc1", "INBOX", false, true, true);
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("reconcile=1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("live=1");
  });

  it("syncEmailHub degrades when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ synced: "yes" }));
    await expect(syncEmailHub("ws1", "acc1", "INBOX")).resolves.toEqual({ synced: false });
  });

  it("getEmailHubThread fetches metadata by default and body when requested", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...thread, body_cached: false, body_text: "" }));
    const meta = await getEmailHubThread("ws1", "acc1", "th1");
    expect(meta?.snippet).toBe("Hi there");
    expect(vi.mocked(fetch).mock.calls[0]![0]).not.toContain("body=1");

    vi.mocked(fetch).mockResolvedValueOnce(json(thread));
    const full = await getEmailHubThread("ws1", "acc1", "th1", true, true);
    expect(full?.body_text).toBe("Hi there");
    expect(vi.mocked(fetch).mock.calls[1]![0]).toContain("body=1");
    expect(vi.mocked(fetch).mock.calls[1]![0]).toContain("mark_read=1");
  });

  it("patchEmailHubThread marks read and degrades when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...thread, is_read: false }));
    const updated = await patchEmailHubThread("ws1", "th1", { accountId: "acc1", isRead: false });
    expect(updated?.is_read).toBe(false);

    vi.mocked(fetch).mockResolvedValueOnce(json({ id: 1 }));
    await expect(patchEmailHubThread("ws1", "th1", { accountId: "acc1", isRead: true })).resolves.toBeNull();
  });

  it("sendEmailHub includes bcc when provided", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json(thread, 201));
    await sendEmailHub("ws1", {
      accountId: "acc1",
      to: ["client@example.com"],
      bcc: ["hidden@example.com"],
      subject: "Hello",
      bodyText: "Hi",
    });
    const body = JSON.parse(String(vi.mocked(fetch).mock.calls[0]![1]?.body));
    expect(body.bcc).toEqual(["hidden@example.com"]);
  });

  it("listEmailHubScheduledSends degrades when malformed", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({ scheduled: [{ id: "sch1", send_at: "2026-09-21T10:00:00Z", subject: "Later", to: ["a@b.com"], status: "pending" }] }),
    );
    const list = await listEmailHubScheduledSends("ws1", "acc1");
    expect(list.scheduled).toHaveLength(1);
    expect(list.scheduled[0]?.id).toBe("sch1");

    vi.mocked(fetch).mockResolvedValueOnce(json({ scheduled: [{ id: 1 }] }));
    await expect(listEmailHubScheduledSends("ws1", "acc1")).resolves.toEqual({ scheduled: [] });
  });

  it("cancelEmailHubScheduledSend calls DELETE with account_id", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await cancelEmailHubScheduledSend("ws1", "acc1", "sch1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("scheduled-sends/sch1");
    expect(vi.mocked(fetch).mock.calls[0]![0]).toContain("account_id=acc1");
  });

  it("getEmailHubThreadSummary returns null on 404 and parses cache payload", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 404 }));
    const missing = await getEmailHubThreadSummary("ws1", "acc1", "th1", "vi");
    expect(missing).toBeNull();

    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        summary: "Cached",
        key_points: [],
        action_items: [],
        needs_reply: false,
        reply_hint: "",
        model: "fake",
        cached: true,
        summarized_at: "2026-01-01T00:00:00Z",
      }),
    );
    const hit = await getEmailHubThreadSummary("ws1", "acc1", "th1", "vi");
    expect(hit?.summary).toBe("Cached");
    expect(hit?.cached).toBe(true);

    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: true }));
    const bad = await getEmailHubThreadSummary("ws1", "acc1", "th1", "vi");
    expect(bad?.summary).toBe("");
  });

  it("summarizeEmailHubThread parses and degrades malformed payloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      json({
        summary: "Tóm tắt",
        key_points: ["Điểm 1"],
        action_items: [{ title: "Việc A", owner: "", due: "" }],
        needs_reply: false,
        reply_hint: "",
        model: "fake",
      }),
    );
    const sum = await summarizeEmailHubThread("ws1", "acc1", "th1", "vi");
    expect(sum.summary).toBe("Tóm tắt");
    expect(sum.key_points).toEqual(["Điểm 1"]);

    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: 1 }));
    const bad = await summarizeEmailHubThread("ws1", "acc1", "th1", "vi");
    expect(bad.summary).toBe("");

    vi.mocked(fetch).mockResolvedValueOnce(json({ summary: "Fresh", key_points: [], action_items: [] }));
    await summarizeEmailHubThread("ws1", "acc1", "th1", "vi", { force: true });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      account_id: "acc1",
      locale: "vi",
      force: true,
    });
  });

  it("patchEmailHubThread toggles starred", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({ ...thread, is_starred: true }));
    const updated = await patchEmailHubThread("ws1", "th1", { accountId: "acc1", isStarred: true });
    expect(updated?.is_starred).toBe(true);
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls.at(-1)?.[1]?.body))).toMatchObject({
      account_id: "acc1",
      is_starred: true,
    });
  });
});

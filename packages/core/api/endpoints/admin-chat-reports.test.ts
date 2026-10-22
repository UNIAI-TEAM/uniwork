import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { EMPTY_CHAT_REPORT_PAGE, listAdminChatReports, removeAdminReportedMessage, resolveAdminChatReport } from "./admin-chat-reports";

beforeEach(() => { configureRuntime({ apiUrl: "http://api.test" }); vi.stubGlobal("fetch", vi.fn()); });
afterEach(() => { vi.unstubAllGlobals(); resetRuntimeConfig(); });
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });
const report = {
  id: "r1", organization_id: "o1", organization_slug: "acme", organization_name: "Acme", organization_status: "active",
  workspace_id: "w1", message_id: "m1", room_id: "room1", target_user_id: "u2", reporter_id: "u1", reason: "harassment", status: "open",
  created_at: "2026-10-22T08:00:00Z",
};

it("lists the queue with its filter and paging, and resolves with the reason", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ reports: [report], total: 1, open_count: 1, oldest_open_at: "2026-10-22T08:00:00Z" }));
  expect(await listAdminChatReports({ status: "open" })).toEqual({ reports: [report], total: 1, open_count: 1, oldest_open_at: "2026-10-22T08:00:00Z" });
  expect(fetch).toHaveBeenCalledWith("http://api.test/api/v1/admin/chat-reports?status=open&limit=50&offset=0", expect.anything());
  vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "resolved" }));
  expect(await resolveAdminChatReport("r1", "asked the owner to remove it")).toEqual({ id: "r1", status: "resolved" });
  expect(fetch).toHaveBeenLastCalledWith("http://api.test/api/v1/admin/chat-reports/r1/resolve", expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "asked the owner to remove it" }) }));
});

it("degrades a malformed answer instead of throwing, and never claims a resolve it did not get", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ reports: "wrong" }));
  expect(await listAdminChatReports()).toEqual(EMPTY_CHAT_REPORT_PAGE);
  // A drifted optional field keeps the page.
  vi.mocked(fetch).mockResolvedValueOnce(json({ reports: [{ ...report, organization_name: 7, reporter_id: null }], total: 1 }));
  const page = await listAdminChatReports();
  expect(page.reports[0]).toMatchObject({ id: "r1", organization_name: "", reporter_id: "" });
  expect(page.open_count).toBe(0);
  vi.mocked(fetch).mockResolvedValueOnce(json({ ok: true }));
  expect(await resolveAdminChatReport("r1", "asked the owner to remove it")).toBeNull();
});

it("takes a reported message down with the reason, and never claims a takedown it did not get", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(json({ id: "r1", status: "resolved" }));
  expect(await removeAdminReportedMessage("r1", "objectionable content taken down")).toEqual({ id: "r1", status: "resolved" });
  expect(fetch).toHaveBeenLastCalledWith(
    "http://api.test/api/v1/admin/chat-reports/r1/remove-message",
    expect.objectContaining({ method: "POST", body: JSON.stringify({ reason: "objectionable content taken down" }) }),
  );
  vi.mocked(fetch).mockResolvedValueOnce(json({ removed: true }));
  expect(await removeAdminReportedMessage("r1", "objectionable content taken down")).toBeNull();
});

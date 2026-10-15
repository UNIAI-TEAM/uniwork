import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { ApiError } from "../http";
import { setAccessToken } from "../session";
import {
  acquireDocumentEditLock,
  answerDocumentEditRequest,
  cancelDocumentEditRequest,
  createDocumentEditRequest,
  deleteDocumentEditHold,
  getDocumentEditLock,
  heartbeatDocumentEditLock,
  putDocumentEditHold,
  releaseDocumentEditLock,
  takeOverDocumentEditLock,
} from "./documents-edit-lock";

// UNI-1645 R1-R10 against the contract's wire shapes (card (a) §3, v2 C2-1).

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const noContent = () => new Response(null, { status: 204 });

const lock = (over: Record<string, unknown> = {}) => ({
  lock_id: "01J8LOCK000000000000000001",
  document_id: "d1",
  holder_id: "u1",
  client: "web_page",
  acquired_at: "2026-10-15T03:12:00Z",
  expires_at: "2026-10-15T03:14:00Z",
  granted_via: "acquire",
  heartbeat_interval_ms: 30000,
  ttl_ms: 120000,
  server_time: "2026-10-15T03:12:00Z",
  ...over,
});

const editRequest = (over: Record<string, unknown> = {}) => ({
  request_id: "r1",
  document_id: "d1",
  requester_id: "u2",
  requester_name: "Bình",
  holder_id: "u1",
  status: "pending",
  created_at: "2026-10-15T03:13:00Z",
  expires_at: "2026-10-15T03:28:00Z",
  ...over,
});

const state = (over: Record<string, unknown> = {}) => ({
  lock: {
    lock_id: "01J8LOCK000000000000000001",
    holder_id: "u1",
    holder_name: "An",
    holder_avatar_url: null,
    since: "2026-10-15T03:12:00Z",
    expires_at: "2026-10-15T03:14:00Z",
    offline_hold_until: "2026-10-15T11:12:00Z",
    reserved: false,
    held_by_me: false,
  },
  my_request: null,
  pending_requests: [],
  can_take_over: true,
  can_request: true,
  server_time: "2026-10-15T03:13:00Z",
  ...over,
});

const malformedBodies = [{ nope: true }, { lock_id: 42 }, null, [], "str"];

function lastCall() {
  const calls = vi.mocked(fetch).mock.calls;
  const [url, init] = calls[calls.length - 1]!;
  return { path: new URL(String(url)).pathname, init: init ?? {} };
}

describe("documents-edit-lock endpoints (UNI-1645)", () => {
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

  describe("R1 getDocumentEditLock", () => {
    it("parses the holder summary, its take-over key and the flags", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json(state()));
      const out = await getDocumentEditLock("d1");
      expect(lastCall().path).toBe("/api/v1/documents/d1/edit-lock");
      expect(out?.lock?.holder_name).toBe("An");
      expect(out?.lock?.lock_id).toBe("01J8LOCK000000000000000001");
      expect(out?.lock?.offline_hold_until).toBe("2026-10-15T11:12:00Z");
      expect(out).toMatchObject({ can_take_over: true, can_request: true, my_request: null, pending_requests: [] });
    });

    it("reads a free document and the holder's pending requests, dropping a bad row", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        json(state({ lock: null, pending_requests: [editRequest(), { request_id: 7 }], can_take_over: false })),
      );
      const out = await getDocumentEditLock("d1");
      expect(out?.lock).toBeNull();
      expect(out?.pending_requests.map((r) => r.request_id)).toEqual(["r1"]);
    });

    it("defaults pending_requests when the field is absent", async () => {
      const body: Record<string, unknown> = state();
      delete body.pending_requests;
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      expect((await getDocumentEditLock("d1"))?.pending_requests).toEqual([]);
    });

    it.each(malformedBodies)("degrades a malformed answer to null: %j", async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(getDocumentEditLock("d1")).resolves.toBeNull();
    });
  });

  describe("R2 acquireDocumentEditLock", () => {
    it("posts editor_id, client and move_from_self and parses the lock", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json(lock(), 201));
      const out = await acquireDocumentEditLock("d1", { editor_id: "e1", client: "web_page", move_from_self: true });
      const { path, init } = lastCall();
      expect(path).toBe("/api/v1/documents/d1/edit-lock");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({ editor_id: "e1", client: "web_page", move_from_self: true });
      expect(out?.lock_id).toBe("01J8LOCK000000000000000001");
      expect(out?.heartbeat_interval_ms).toBe(30000);
    });

    it("rejects 423 document_locked with the holder fields and no lock id", async () => {
      const fields = { holder_id: "u2", holder_name: "Bình", since: "2026-10-15T03:12:00Z", expires_at: "2026-10-15T03:20:00Z", held_by_me: false, current_revision: "42" };
      vi.mocked(fetch).mockResolvedValueOnce(json({ error: { code: "document_locked", message: "locked", fields } }, 423));
      const err = await acquireDocumentEditLock("d1", { editor_id: "e1", client: "web_page" }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 423, code: "document_locked", fields });
    });

    it.each(malformedBodies)("degrades a malformed answer to null: %j", async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(acquireDocumentEditLock("d1", { editor_id: "e1", client: "web_page" })).resolves.toBeNull();
    });
  });

  describe("R3 heartbeatDocumentEditLock", () => {
    it("posts to the tenure and parses the new expiry", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ lock_id: "L1", expires_at: "2026-10-15T03:16:00Z", server_time: "2026-10-15T03:14:00Z" }));
      const out = await heartbeatDocumentEditLock("d1", "L1");
      expect(lastCall().path).toBe("/api/v1/documents/d1/edit-lock/L1/heartbeat");
      expect(lastCall().init.method).toBe("POST");
      expect(out?.expires_at).toBe("2026-10-15T03:16:00Z");
    });

    it("rejects 409 edit_lock_lost with the reason", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        json({ error: { code: "edit_lock_lost", message: "lost", fields: { reason: "taken_over", by_id: "u3", by_name: "Chi" } } }, 409),
      );
      await expect(heartbeatDocumentEditLock("d1", "L1")).rejects.toMatchObject({ code: "edit_lock_lost", fields: { reason: "taken_over" } });
    });

    it.each(malformedBodies)("degrades a malformed answer to null: %j", async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(heartbeatDocumentEditLock("d1", "L1")).resolves.toBeNull();
    });
  });

  describe("R4 releaseDocumentEditLock", () => {
    it("deletes the tenure and passes keepalive to the transport", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(noContent());
      await releaseDocumentEditLock("d1", "L1", { keepalive: true });
      const { path, init } = lastCall();
      expect(path).toBe("/api/v1/documents/d1/edit-lock/L1");
      expect(init.method).toBe("DELETE");
      expect(init.keepalive).toBe(true);
      expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    });

    it("ignores an unexpected body on the 204 route", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json({ unexpected: true }));
      await expect(releaseDocumentEditLock("d1", "L1")).resolves.toBeUndefined();
    });
  });

  describe("R5 takeOverDocumentEditLock", () => {
    it("posts the expected lock id and parses the new tenure", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json(lock({ lock_id: "L2", granted_via: "take_over" }), 201));
      const out = await takeOverDocumentEditLock("d1", { editor_id: "e1", client: "web_office", expected_lock_id: "L1" });
      expect(lastCall().path).toBe("/api/v1/documents/d1/edit-lock/take-over");
      expect(JSON.parse(String(lastCall().init.body))).toEqual({ editor_id: "e1", client: "web_office", expected_lock_id: "L1" });
      expect(out?.granted_via).toBe("take_over");
    });

    it.each(malformedBodies)("degrades a malformed answer to null: %j", async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body));
      await expect(takeOverDocumentEditLock("d1", { editor_id: "e1", client: "web_page", expected_lock_id: "L1" })).resolves.toBeNull();
    });
  });

  describe("R6/R7 offline hold", () => {
    it("puts and deletes the hold on the tenure", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json(lock({ offline_hold_until: "2026-10-15T11:12:00Z" })));
      expect((await putDocumentEditHold("d1", "L1"))?.offline_hold_until).toBe("2026-10-15T11:12:00Z");
      expect(lastCall()).toMatchObject({ path: "/api/v1/documents/d1/edit-lock/L1/offline-hold", init: { method: "PUT", body: "{}" } });
      vi.mocked(fetch).mockResolvedValueOnce(json(lock({ offline_hold_until: null })));
      expect((await deleteDocumentEditHold("d1", "L1"))?.offline_hold_until).toBeNull();
      expect(lastCall().init.method).toBe("DELETE");
    });

    it.each(malformedBodies)("degrades a malformed answer to null: %j", async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body)).mockResolvedValueOnce(json(body));
      await expect(putDocumentEditHold("d1", "L1")).resolves.toBeNull();
      await expect(deleteDocumentEditHold("d1", "L1")).resolves.toBeNull();
    });
  });

  describe("R8-R10 edit requests", () => {
    it("creates, answers and cancels a request", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(json(editRequest(), 201));
      expect((await createDocumentEditRequest("d1"))?.request_id).toBe("r1");
      expect(lastCall()).toMatchObject({ path: "/api/v1/documents/d1/edit-requests", init: { method: "POST", body: "{}" } });

      vi.mocked(fetch).mockResolvedValueOnce(json(editRequest({ status: "accepted", answered_at: "2026-10-15T03:14:00Z" })));
      const answered = await answerDocumentEditRequest("d1", "r1", { decision: "accept", lock_id: "L1" });
      expect(answered?.status).toBe("accepted");
      expect(lastCall().path).toBe("/api/v1/documents/d1/edit-requests/r1/answer");
      expect(JSON.parse(String(lastCall().init.body))).toEqual({ decision: "accept", lock_id: "L1" });

      vi.mocked(fetch).mockResolvedValueOnce(noContent());
      await cancelDocumentEditRequest("d1", "r1");
      expect(lastCall()).toMatchObject({ path: "/api/v1/documents/d1/edit-requests/r1", init: { method: "DELETE" } });
    });

    it("rejects 429 edit_request_rate_limited with retry_after_s", async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        json({ error: { code: "edit_request_rate_limited", message: "slow down", fields: { retry_after_s: 30 } } }, 429),
      );
      await expect(createDocumentEditRequest("d1")).rejects.toMatchObject({ status: 429, fields: { retry_after_s: 30 } });
    });

    it.each(malformedBodies)("degrades a malformed answer to null: %j", async (body) => {
      vi.mocked(fetch).mockResolvedValueOnce(json(body)).mockResolvedValueOnce(json(body));
      await expect(createDocumentEditRequest("d1")).resolves.toBeNull();
      await expect(answerDocumentEditRequest("d1", "r1", { decision: "decline", lock_id: "L1" })).resolves.toBeNull();
    });
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import type { Document } from "../types/document";
import {
  DocumentSaveMachine,
  type DocumentSaveRequest,
  type DocumentSaveTransport,
} from "./save-state";

// The machine drives a fake transport: every send is recorded and resolved
// by hand, and the request's AbortSignal rejects when the machine times out.

function stubDoc(revision: string, over: Record<string, unknown> = {}): Document {
  return {
    id: "d1",
    organization_id: "o1",
    workspace_id: "w1",
    kind: "page",
    title: "t",
    visibility: "workspace",
    revision,
    current_version: 0,
    position: 0,
    content_text: "",
    breadcrumbs: [],
    created_by: "u1",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "",
    ...over,
  } as Document;
}

interface PendingCall {
  req: DocumentSaveRequest;
  resolve: (doc: Document | null) => void;
  reject: (err: unknown) => void;
}

function fakeTransport() {
  const calls: DocumentSaveRequest[] = [];
  const pending: PendingCall[] = [];
  const impl: DocumentSaveTransport = (req) => {
    calls.push(req);
    return new Promise<Document | null>((resolve, reject) => {
      pending.push({ req, resolve, reject });
      req.signal.addEventListener("abort", () =>
        reject(new DOMException("aborted", "AbortError")),
      );
    });
  };
  return { impl, calls, pending };
}

function machine(transport: DocumentSaveTransport, over = {}) {
  return new DocumentSaveMachine({
    documentId: "d1",
    initialRevision: "41",
    transport,
    debounceMs: 2_000,
    timeoutMs: 30_000,
    ...over,
  });
}

async function settle() {
  await vi.advanceTimersByTimeAsync(0);
}

describe("DocumentSaveMachine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("debounces edits into one save after the quiet window", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    m.edit({ title: "b", content: { type: "doc" } });
    expect(m.getState().phase).toBe("debouncing");
    await vi.advanceTimersByTimeAsync(1_999);
    expect(t.calls).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(t.calls).toHaveLength(1);
    // The merged draft wins, on the machine's latest acknowledged base.
    expect(t.calls[0]?.patch).toEqual({ title: "b", content: { type: "doc" } });
    expect(t.calls[0]?.baseRevision).toBe("41");
    t.pending[0]?.resolve(stubDoc("42"));
    await settle();
    const s = m.getState();
    expect(s.phase).toBe("saved");
    expect(s.revision).toBe("42");
    expect(s.dirty).toBe(false);
    expect(s.idempotencyKey).toBeNull();
    expect(s.acked?.revision).toBe("42");
  });

  it("keeps one request in flight and queues the next edit on the new revision", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.calls).toHaveLength(1);

    // An edit during the flight queues; it does not open a second request.
    m.edit({ content: { type: "doc", v: 2 } });
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.calls).toHaveLength(1);
    expect(m.getState().dirty).toBe(true);

    t.pending[0]?.resolve(stubDoc("42"));
    await settle();
    // Queued edit goes out on the acknowledged revision after the debounce.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.baseRevision).toBe("42");
    expect(t.calls[1]?.patch).toEqual({ content: { type: "doc", v: 2 } });
    t.pending[1]?.resolve(stubDoc("43"));
    await settle();
    expect(m.getState().phase).toBe("saved");
    expect(m.getState().revision).toBe("43");
  });

  it("a conflict stops the machine and never auto-retries", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    await vi.advanceTimersByTimeAsync(2_000);
    t.pending[0]?.reject(
      new ApiError("stale", "revision_conflict", 422, undefined, { current_revision: "45" }),
    );
    await settle();
    const s = m.getState();
    expect(s.phase).toBe("conflict");
    expect(s.dirty).toBe(true);
    expect(s.errorClass).toBe("conflict");
    expect(s.errorCode).toBe("revision_conflict");
    expect(s.errorFields?.["current_revision"]).toBe("45");
    // The base stays at 41 — the caller resolves, the machine never does.
    expect(s.revision).toBe("41");

    await vi.advanceTimersByTimeAsync(60_000);
    expect(t.calls).toHaveLength(1);
    m.retry();
    await settle();
    expect(t.calls).toHaveLength(1);

    m.conflictResolved("45", stubDoc("45"));
    const resolved = m.getState();
    expect(resolved.phase).toBe("idle");
    expect(resolved.revision).toBe("45");
    expect(resolved.dirty).toBe(false);
  });

  it("a timeout keeps the draft and replays the same idempotency key", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    await vi.advanceTimersByTimeAsync(2_000);
    const key = t.calls[0]?.idempotencyKey;
    expect(key).toBeTruthy();

    // The transport never answers; the machine's own timeout aborts it.
    await vi.advanceTimersByTimeAsync(30_000);
    await settle();
    const s = m.getState();
    expect(s.phase).toBe("error");
    expect(s.errorClass).toBe("unknown");
    expect(s.dirty).toBe(true);
    expect(s.idempotencyKey).toBe(key);
    expect(s.revision).toBe("41");

    m.retry();
    await settle();
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.idempotencyKey).toBe(key);
    expect(t.calls[1]?.baseRevision).toBe("41");
    t.pending[1]?.resolve(stubDoc("42"));
    await settle();
    expect(m.getState().phase).toBe("saved");
  });

  it("an unknown transport failure keeps draft + key and retries identically", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ content: "x" });
    await vi.advanceTimersByTimeAsync(2_000);
    const key = t.calls[0]?.idempotencyKey;
    t.pending[0]?.reject(new TypeError("network down"));
    await settle();
    expect(m.getState().phase).toBe("error");
    expect(m.getState().errorClass).toBe("unknown");
    m.retry();
    await settle();
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.idempotencyKey).toBe(key);
    expect(t.calls[1]?.patch).toEqual({ content: "x" });
  });

  it("a 2xx that cannot prove the write is unverifiable, not saved", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    await vi.advanceTimersByTimeAsync(2_000);
    const key = t.calls[0]?.idempotencyKey;
    t.pending[0]?.resolve(null); // endpoint parse failed → null
    await settle();
    const s = m.getState();
    expect(s.phase).toBe("unverifiable");
    expect(s.dirty).toBe(true);
    expect(s.idempotencyKey).toBe(key);

    m.retry();
    await settle();
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.idempotencyKey).toBe(key);
  });

  it("a response for another document is unverifiable", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    await vi.advanceTimersByTimeAsync(2_000);
    t.pending[0]?.resolve(stubDoc("42", { id: "other" }));
    await settle();
    expect(m.getState().phase).toBe("unverifiable");
    expect(m.getState().revision).toBe("41");
  });

  it("a mutated batch after failure gets a new key, never a payload-mismatch replay", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    await vi.advanceTimersByTimeAsync(2_000);
    const key = t.calls[0]?.idempotencyKey;
    t.pending[0]?.reject(new TypeError("network down"));
    await settle();

    // The draft changed while the failed batch flew: a different write needs
    // a different key or the server answers idempotency_payload_mismatch.
    m.edit({ title: "a2" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.calls).toHaveLength(2);
    expect(t.calls[1]?.idempotencyKey).not.toBe(key);
    expect(t.calls[1]?.patch).toEqual({ title: "a2" });
  });

  it("flush skips the quiet window", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    m.flush();
    await settle();
    expect(t.calls).toHaveLength(1);
  });

  it("discardDraft drops the pending write and its key", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.edit({ title: "a" });
    m.discardDraft();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(t.calls).toHaveLength(0);
    expect(m.getState().dirty).toBe(false);
    expect(m.getState().phase).toBe("idle");
  });

  it("updateBase adopts a newer revision only while the machine is clean", async () => {
    const t = fakeTransport();
    const m = machine(t.impl);
    m.updateBase("44", stubDoc("44"));
    expect(m.getState().revision).toBe("44");
    m.edit({ title: "a" });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(t.calls[0]?.baseRevision).toBe("44");

    // While a draft or flight exists the base belongs to the pending write.
    m.updateBase("99");
    expect(m.getState().revision).toBe("44");
  });
});

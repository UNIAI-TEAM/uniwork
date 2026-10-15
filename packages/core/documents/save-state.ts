import type { Document, DocumentErrorClass, DocumentVisibility } from "../types/document";
import { classifyDocumentError, isConflictClass } from "./errors";

/**
 * The Documents save machine (plan G1-05; UNI-679). One instance per open
 * document owns the page-autosave loop:
 *
 *  - edits debounce 2 s, then PATCH the working copy;
 *  - exactly one request is in flight per document — edits that land while a
 *    save flies are queued and go out on the newly acknowledged revision;
 *  - every draft batch carries one idempotency key, minted at first send and
 *    kept across unknown-error/timeout retries so a replayed request is
 *    provably the same write;
 *  - a 2xx that fails schema/identity is "unverifiable", never saved;
 *  - a conflict-class answer stops the machine: the draft stays, the key
 *    stays, and nothing retries on a newer base until the caller resolves it;
 *  - a 423 document_locked (someone else holds the edit lock, UNI-1645)
 *    stops it the same way in "locked": the content stays, nothing retries,
 *    and only lockRestored() or discardDraft() leaves it.
 *
 * It is transport-agnostic: the caller injects `transport` (the patchDocument
 * endpoint in production, a fake in tests) and reads `getState()` or
 * `subscribe()`.
 */

export type DocumentSavePhase =
  /** Nothing pending and nothing acknowledged yet worth announcing. */
  | "idle"
  /** A draft is inside the quiet window. */
  | "debouncing"
  /** One request is in flight. */
  | "saving"
  /** The last write was acknowledged; stays until the next edit. */
  | "saved"
  /** A conflict-class answer; the draft is kept and nothing retries. */
  | "conflict"
  /** 423 document_locked: someone else holds the edit lock. Autosave stops,
   *  the draft is kept, and nothing retries until lockRestored(). */
  | "locked"
  /** Unknown or transport-level failure; draft + key kept for retry(). */
  | "error"
  /** A 2xx answer that could not prove the write; draft + key kept. */
  | "unverifiable";

export interface DocumentSaveState {
  phase: DocumentSavePhase;
  /** Latest revision the server acknowledged, as a decimal string. */
  revision: string;
  /** A draft exists that has not been proven saved. */
  dirty: boolean;
  /** The idempotency key bound to the current draft batch. */
  idempotencyKey: string | null;
  errorClass: DocumentErrorClass | "unknown" | null;
  errorCode: string | null;
  errorFields: Record<string, unknown> | undefined;
  /** The edit lock id the last send carried (UNI-1645): a 423 ends the hold only
   *  when this is still the editor's current id. */
  sentEditLockId: string | undefined;
  /** The document of the last acknowledged save. */
  acked: Document | null;
}

/** The patch payload a draft carries — PatchDocumentBody minus revision,
 *  which is always the machine's latest acknowledged revision at send time. */
export interface PageDraft {
  title?: string;
  icon?: string;
  content?: unknown;
  visibility?: DocumentVisibility;
}

export interface DocumentSaveRequest {
  documentId: string;
  /** The acknowledged revision the draft patches. */
  baseRevision: string;
  patch: PageDraft;
  idempotencyKey: string;
  signal: AbortSignal;
  /** The editor's live edit lock at send time (UNI-1645); absent = none. */
  editLockId?: string;
}

export type DocumentSaveTransport = (req: DocumentSaveRequest) => Promise<Document | null>;

export interface DocumentSaveMachineOptions {
  documentId: string;
  /** The revision of the document the editor opened (decimal string). */
  initialRevision: string;
  transport: DocumentSaveTransport;
  /** Quiet window before an edit flushes. Default 2 000 ms. */
  debounceMs?: number;
  /** Give up on one in-flight save after this. Default 30 000 ms; an aborted
   *  save classifies "unknown" and keeps draft + key. */
  timeoutMs?: number;
  newIdempotencyKey?: () => string;
  /** Read at each send: the edit lock the editor holds now (UNI-1645). */
  getEditLockId?: () => string | undefined;
}

function defaultIdempotencyKey(): string {
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "");
  if (random) return `doc_${random}`;
  return `doc_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export class DocumentSaveMachine {
  private draft: PageDraft | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private abort: AbortController | undefined;
  private inFlight = false;
  private disposed = false;
  private key: string | null = null;
  /** The lock id the current key was minted under. */
  private keyLockId: string | undefined;
  private readonly listeners = new Set<() => void>();
  private state: DocumentSaveState;
  private readonly mintKey: () => string;

  constructor(private readonly opts: DocumentSaveMachineOptions) {
    this.mintKey = opts.newIdempotencyKey ?? defaultIdempotencyKey;
    this.state = {
      phase: "idle",
      revision: opts.initialRevision,
      dirty: false,
      idempotencyKey: null,
      errorClass: null,
      errorCode: null,
      errorFields: undefined,
      sentEditLockId: undefined,
      acked: null,
    };
  }

  getState(): Readonly<DocumentSaveState> {
    return this.state;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Merge one edit into the pending draft and (re)start the quiet window.
   *  While a save flies the edit queues; while in conflict the draft grows
   *  but nothing schedules — the machine never auto-retries on a new base. */
  edit(draft: PageDraft): void {
    if (this.disposed) return;
    this.draft = { ...this.draft, ...draft };
    // The kept key belongs to the exact batch it was minted for; once the
    // pending draft changes, the next send is a different write and needs a
    // different key — a mutated payload under an old key answers
    // idempotency_payload_mismatch.
    if (this.key) this.key = null;
    if (this.inFlight || this.stopped()) {
      this.setState({ dirty: true });
      return;
    }
    this.schedule();
  }

  /** Skip the quiet window and send now. With a save in flight the draft
   *  waits for the ack, then goes on the acknowledged revision. */
  flush(): void {
    if (this.disposed) return;
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    void this.send();
  }

  /** Manual retry after "error" / "unverifiable": same draft, same key.
   *  Ignored while a save flies, in "conflict" — retrying a stale base is
   *  just another 409 — and in "locked", which only lockRestored() leaves. */
  retry(): void {
    if (this.disposed || this.inFlight || !this.draft || this.stopped()) return;
    void this.send();
  }

  /** Drop the pending draft and its key — the caller reloads the server's
   *  copy and the user starts over. */
  discardDraft(): void {
    if (this.disposed) return;
    this.draft = undefined;
    this.key = null;
    this.clearTimer();
    this.setState({
      phase: "idle",
      dirty: false,
      idempotencyKey: null,
      errorClass: null,
      errorCode: null,
      errorFields: undefined,
    });
  }

  /** The caller re-fetched the document after a conflict: adopt the fresh
   *  revision and drop the rejected draft (the editor keeps its own copy and
   *  can edit() again on this base). */
  conflictResolved(revision: string, acked?: Document | null): void {
    if (this.disposed || this.state.phase !== "conflict") return;
    this.draft = undefined;
    this.key = null;
    this.clearTimer();
    this.setState({
      phase: "idle",
      revision,
      dirty: false,
      idempotencyKey: null,
      errorClass: null,
      errorCode: null,
      errorFields: undefined,
      acked: acked ?? this.state.acked,
    });
  }

  /** The editor holds the edit lock again on the same base (UNI-1645): leave
   *  "locked" and send the kept draft after the quiet window. */
  lockRestored(): void {
    if (this.disposed || this.state.phase !== "locked") return;
    this.setState({ phase: "idle", errorClass: null, errorCode: null, errorFields: undefined });
    if (this.draft) this.schedule();
  }

  /** Adopt a revision the query cache learned while the machine was clean
   *  (a refetch, another member's write). Ignored while a draft or a flight
   *  exists — the in-flight base or the pending draft owns it. */
  updateBase(revision: string, acked?: Document | null): void {
    if (this.disposed || this.draft || this.inFlight || !revision || revision === this.state.revision)
      return;
    this.setState({ revision, acked: acked ?? this.state.acked });
  }

  /** True once dispose() ran. A host that remounts (React StrictMode runs
   *  mount → cleanup → mount in development) needs a live machine, not this
   *  one. */
  isDisposed(): boolean {
    return this.disposed;
  }

  /** Tear down on unmount: clears the quiet window, aborts the in-flight
   *  request and drops every later outcome — a transport that resolves
   *  anyway must not schedule a new save from a dead machine. */
  dispose(): void {
    this.disposed = true;
    this.clearTimer();
    this.abort?.abort();
    this.listeners.clear();
  }

  /** Phases that never send on their own: the caller must resolve them. */
  private stopped(): boolean {
    return this.state.phase === "conflict" || this.state.phase === "locked";
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }

  private setState(patch: Partial<DocumentSaveState>): void {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  private schedule(): void {
    if (this.disposed) return;
    this.clearTimer();
    this.setState({ phase: "debouncing", dirty: true });
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.send();
    }, this.opts.debounceMs ?? 2_000);
  }

  /** Fold an unsent batch back into the pending draft. Edits that landed
   *  during the flight win field-by-field — and change the payload, so the
   *  batch's idempotency key is dropped: replaying it under the same key
   *  would trip the server's fingerprint check (idempotency_payload_mismatch).
   *  An untouched batch keeps its key and replays identically. */
  private requeue(sending: PageDraft): void {
    if (this.draft) {
      this.draft = { ...sending, ...this.draft };
      this.key = null;
    } else {
      this.draft = sending;
    }
  }

  private async send(): Promise<void> {
    if (this.disposed || this.inFlight || !this.draft || this.stopped()) return;
    const sending = this.draft;
    this.draft = undefined;
    this.inFlight = true;
    const lockId = this.opts.getEditLockId?.();
    // The key belongs to one payload, and edit_lock_id is part of it.
    if (this.key && this.keyLockId !== lockId) this.key = null;
    if (!this.key) this.keyLockId = lockId;
    this.key ??= this.mintKey();
    const controller = new AbortController();
    this.abort = controller;
    const timeout = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 30_000);
    this.setState({
      phase: "saving",
      dirty: true,
      idempotencyKey: this.key,
      errorClass: null,
      errorCode: null,
      errorFields: undefined,
      sentEditLockId: lockId,
    });
    try {
      const doc = await this.opts.transport({
        documentId: this.opts.documentId,
        baseRevision: this.state.revision,
        patch: sending,
        idempotencyKey: this.key,
        signal: controller.signal,
        editLockId: lockId,
      });
      // Disposed mid-flight: drop the answer — nothing may schedule or
      // announce from a machine the editor already tore down.
      if (this.disposed) return;
      if (doc && doc.id === this.opts.documentId && doc.revision) {
        this.key = null;
        const queued = !!this.draft;
        this.setState({
          phase: queued ? "debouncing" : "saved",
          revision: doc.revision,
          dirty: queued,
          idempotencyKey: null,
          acked: doc,
        });
        if (queued) this.schedule();
      } else {
        // A 2xx that cannot prove the write is never read as saved.
        this.requeue(sending);
        this.setState({ phase: "unverifiable", dirty: true });
      }
    } catch (err) {
      if (this.disposed) return;
      this.requeue(sending);
      const cls = classifyDocumentError(err);
      this.setState({
        phase: cls.cls === "locked" ? "locked" : isConflictClass(cls.cls) ? "conflict" : "error",
        dirty: true,
        errorClass: cls.cls,
        errorCode: cls.code,
        errorFields: cls.fields,
      });
    } finally {
      clearTimeout(timeout);
      this.inFlight = false;
      this.abort = undefined;
    }
  }
}

/** The transport production code wires in: PATCH the working copy through
 *  the endpoint, carrying the machine's base revision and idempotency key. */
export function createDocumentPatchTransport(
  patch: (
    documentId: string,
    body: {
      revision: string;
      title?: string;
      icon?: string;
      content?: unknown;
      visibility?: DocumentVisibility;
      edit_lock_id?: string;
    },
    opts?: { idempotencyKey?: string; signal?: AbortSignal },
  ) => Promise<Document | null>,
): DocumentSaveTransport {
  return (req) =>
    patch(
      req.documentId,
      { revision: req.baseRevision, ...req.patch, ...(req.editLockId ? { edit_lock_id: req.editLockId } : {}) },
      { idempotencyKey: req.idempotencyKey, signal: req.signal },
    );
}

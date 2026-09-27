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
 *    stays, and nothing retries on a newer base until the caller resolves it.
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
  private key: string | null = null;
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
    this.draft = { ...this.draft, ...draft };
    // The kept key belongs to the exact batch it was minted for; once the
    // pending draft changes, the next send is a different write and needs a
    // different key — a mutated payload under an old key answers
    // idempotency_payload_mismatch.
    if (this.key) this.key = null;
    if (this.inFlight || this.state.phase === "conflict") {
      this.setState({ dirty: true });
      return;
    }
    this.schedule();
  }

  /** Skip the quiet window and send now. With a save in flight the draft
   *  waits for the ack, then goes on the acknowledged revision. */
  flush(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    void this.send();
  }

  /** Manual retry after "error" / "unverifiable": same draft, same key.
   *  Ignored while a save flies and in "conflict" — retrying a stale base is
   *  just another 409. */
  retry(): void {
    if (this.inFlight || !this.draft || this.state.phase === "conflict") return;
    void this.send();
  }

  /** Drop the pending draft and its key — the caller reloads the server's
   *  copy and the user starts over. */
  discardDraft(): void {
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
    if (this.state.phase !== "conflict") return;
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

  /** Adopt a revision the query cache learned while the machine was clean
   *  (a refetch, another member's write). Ignored while a draft or a flight
   *  exists — the in-flight base or the pending draft owns it. */
  updateBase(revision: string, acked?: Document | null): void {
    if (this.draft || this.inFlight || !revision || revision === this.state.revision) return;
    this.setState({ revision, acked: acked ?? this.state.acked });
  }

  dispose(): void {
    this.clearTimer();
    this.abort?.abort();
    this.listeners.clear();
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
    if (this.inFlight || !this.draft || this.state.phase === "conflict") return;
    const sending = this.draft;
    this.draft = undefined;
    this.inFlight = true;
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
    });
    try {
      const doc = await this.opts.transport({
        documentId: this.opts.documentId,
        baseRevision: this.state.revision,
        patch: sending,
        idempotencyKey: this.key,
        signal: controller.signal,
      });
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
      this.requeue(sending);
      const cls = classifyDocumentError(err);
      this.setState({
        phase: isConflictClass(cls.cls) ? "conflict" : "error",
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
    body: { revision: string; title?: string; icon?: string; content?: unknown; visibility?: DocumentVisibility },
    opts?: { idempotencyKey?: string; signal?: AbortSignal },
  ) => Promise<Document | null>,
): DocumentSaveTransport {
  return (req) =>
    patch(
      req.documentId,
      { revision: req.baseRevision, ...req.patch },
      { idempotencyKey: req.idempotencyKey, signal: req.signal },
    );
}

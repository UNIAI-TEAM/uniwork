// UNI-927 (P0-1) — the web PPTX runtime.
//
// The pptx engine service binds no pptx handler (apps/office-engine has no
// pptx lane), so — exactly like DOCX — open/edit/save run in the browser:
// the host downloads the authorized file, this runtime binds the generated
// artifact (dist/pptx-renderer.mjs) into office-engine's PptxAdapter, and
// serialize runs the vendored savePptx before the shared coordinator uploads
// and commits a new version. No server edit job, no new Go op kind.
//
// The adapter is a promise queue: an edit never lands inside a savePptx run
// (the engine patches the same archive object the save serializes), and a
// recovered draft replays its journal through the same typed edit channel.
import { bindPptxEngine, bindPptxOps, bindPptxRender, createPptxAdapter, type PptxAdapter, type PptxEdit } from "@uniwork/office-engine/pptx";
import {
  buildRenderSlide,
  commitSaved,
  HeuristicMetrics,
  listSlideLayouts,
  openPptx,
  reparseDeck,
  runTxn,
  savePptx,
} from "@uniwork/office-upstream/pptx-renderer";
// The notes read is an OPTIONAL member of the generated artifact: it exists
// once shims/pptx-renderer-entry.ts re-exports getSlideNotes (a package we do
// not own). Reading it off the namespace keeps this host compiling and makes
// the feature live the moment the artifact carries it - never a fake read.
import * as pptxUpstream from "@uniwork/office-upstream/pptx-renderer";
import type { StableSnapshot } from "@uniwork/core/office";
import type { PptxDeckModel } from "@uniwork/views/office/pptx";

/** The generated artifact's optional speaker-notes read. Undefined until the
 * artifact exports getSlideNotes; the adapter then refuses with a typed
 * notes_unbound instead of inventing notes. */
const upstreamNotesRead = typeof (pptxUpstream as { getSlideNotes?: unknown }).getSlideNotes === "function"
  ? (pptxUpstream as unknown as { getSlideNotes(archive: unknown, slidePath: string): string }).getSlideNotes
  : undefined;

/** One applied edit, JSON-safe (byte payloads become base64). */
export interface PptxJournalEntry {
  op: string;
  [key: string]: unknown;
}

/** The serializable deck snapshot: the applied edit journal, replayed onto
 * the base bytes to restore. The engine model itself never leaves the runtime. */
export interface PptxDeckSnapshot {
  revision: number;
  edits: PptxJournalEntry[];
}

export interface PptxSlideSummary {
  id: string;
  hidden: boolean;
  elements: Array<{ id: string; type: string }>;
}

export interface PptxRuntimeOpenResult {
  outcome: "opened" | "failed";
  document_id: string;
  document_model_ref?: string;
  snapshot?: PptxDeckSnapshot;
  warnings?: readonly unknown[];
  failure_class?: string;
  message?: string;
  engine_error?: string;
}

export interface PptxRuntimeSerializedOutput {
  bytes: Uint8Array;
  checksum: string;
  warnings?: readonly unknown[];
}

/**
 * The host-owned runtime seam. Opens from bytes, edits through the typed
 * PptxEdit channel, and serializes the held model — the browser save the
 * Documents transport then uploads and commits.
 */
export interface PptxSessionRuntime {
  open(input: { bytes: Uint8Array; documentId: string }): Promise<PptxRuntimeOpenResult>;
  edit(documentModelRef: string, edits: readonly PptxEdit[]): Promise<{ revision: number }>;
  snapshot(documentModelRef: string): PptxDeckSnapshot;
  /** Replay a recovered draft journal onto the freshly opened base. */
  restore?(documentModelRef: string, snapshot: PptxDeckSnapshot): Promise<void>;
  /** Journal-backed undo: reopen the base bytes and replay journal[0..cursor-1].
   *  Returns false at the base (nothing left to undo). */
  undo(documentModelRef: string): Promise<boolean>;
  /** Journal-backed redo: replay the entry the last undo removed. Returns false
   *  when the journal is already at its tip. */
  redo(documentModelRef: string): Promise<boolean>;
  serialize(
    documentModelRef: string,
    input: { snapshot: StableSnapshot<PptxDeckSnapshot>; signal?: AbortSignal },
  ): Promise<PptxRuntimeSerializedOutput>;
  /** The opened engine deck the shared canvas renders (EMU size included). */
  deck(documentModelRef: string): PptxDeckModel;
  /** Speaker-notes text of one slide of the LIVE engine session ('' when the
   * slide carries none). Optional on the seam so a hand-built test double that
   * predates this read stays assignable; both shipped runtimes implement it. */
  slideNotes?(documentModelRef: string, slideIndex: number): string;
  slides(documentModelRef: string): PptxSlideSummary[];
  release(documentModelRef: string): Promise<void>;
}

/** SHA-256 hex through WebCrypto (the xlsx runtime's pattern). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error("pptx_checksum_unavailable");
  const digest = await subtle.digest("SHA-256", bytes.slice().buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) out[key] = sortValue(source[key]);
    return out;
  }
  return value;
}

/** Canonical JSON so two structurally equal snapshots fingerprint equally. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

/** Content fingerprint of a deck snapshot (generation-stable, draft safe). */
export async function fingerprintPptxSnapshot(snapshot: PptxDeckSnapshot): Promise<string> {
  return sha256Hex(new TextEncoder().encode(stableJson(snapshot)));
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** PptxEdit → JSON-safe journal entry (Uint8Array fields become base64). */
export function encodePptxEdit(edit: PptxEdit): PptxJournalEntry {
  const copy: Record<string, unknown> = { ...(edit as Record<string, unknown>) };
  for (const key of Object.keys(copy)) {
    const value = copy[key];
    if (value instanceof Uint8Array) copy[key] = { __bytes: bytesToBase64(value) };
  }
  return copy as PptxJournalEntry;
}

export function decodePptxEdit(entry: PptxJournalEntry): PptxEdit {
  const copy: Record<string, unknown> = { ...entry };
  for (const key of Object.keys(copy)) {
    const value = copy[key];
    if (value && typeof value === "object" && "__bytes" in (value as Record<string, unknown>)) {
      copy[key] = base64ToBytes(String((value as { __bytes: unknown }).__bytes));
    }
  }
  return copy as unknown as PptxEdit;
}

/** The engine session model surface the runtime reads. The public `opened`
 * handle carries the REAL deck (`opened.deck`) - the same object openPptx
 * produced and savePptx serializes - so the canvas gets a deck with an EMU
 * `size`; the PptxSessionModel wrapper only proxies `slides` and has none. */
interface LivePptxSession {
  model: {
    opened: {
      deck: {
        slides: Array<{
          id?: string;
          hidden?: boolean;
          elements?: Array<{ id?: string; type?: string }>;
        }>;
      };
    };
  };
}

interface RuntimeSession {
  ref: string;
  journal: PptxEdit[];
  revision: number;
  /** Journal entries the model currently holds; entries past this index were
   * undone and wait on the redo path (a cursor, not a popped stack, so a
   * fresh edit can drop the redo tail the way a text editor does). */
  cursor: number;
  /** The opened base package; undo/redo replay the journal onto it. */
  baseBytes: Uint8Array;
}

export function createWebPptxSessionRuntime(options: { documentId: string }): PptxSessionRuntime {
  const sessions = new Map<string, RuntimeSession>();
  // One stable runtime ref -> the current engine session ref. undo reopens the
  // base into a fresh engine session; the runtime ref (and so the adapter and
  // the editor) never changes across history, only the engine ref behind it.
  const engineRefs = new Map<string, string>();
  let adapter: PptxAdapter | null = null;
  // One serialized lane: edits and serialize never interleave inside the
  // engine's archive mutation/save pair.
  let tail: Promise<void> = Promise.resolve();

  function serializeOperation<T>(operation: () => Promise<T> | T): Promise<T> {
    const run = tail.then(operation, operation);
    tail = run.then(() => undefined, () => undefined);
    return run;
  }

  function engineAdapter(): PptxAdapter {
    adapter ??= createPptxAdapter({
      engine: bindPptxEngine({
        openPptx,
        savePptx,
        commitSaved,
        reparseDeck,
        listSlideLayouts,
        ...(upstreamNotesRead ? { getSlideNotes: upstreamNotesRead } : {}),
      }),
      ops: bindPptxOps({ runTxn }),
      render: bindPptxRender({ buildRenderSlide, HeuristicMetrics }),
      sha256: sha256Hex,
    });
    return adapter;
  }

  function requireSession(ref: string): RuntimeSession {
    const session = sessions.get(ref);
    if (!session) throw new Error("pptx_runtime_not_open");
    return session;
  }

  /** The engine session ref currently backing a runtime ref (undo swaps it). */
  function currentEngineRef(ref: string): string {
    const engineRef = engineRefs.get(ref);
    if (!engineRef) throw new Error("pptx_runtime_not_open");
    return engineRef;
  }

  /** Apply one already-decoded journal entry on the live engine session. */
  function applyEntry(ref: string, entry: PptxEdit): number {
    return engineAdapter().edit(currentEngineRef(ref), entry).revision;
  }

  function liveSession(ref: string): LivePptxSession {
    return engineAdapter().sessionOf(currentEngineRef(ref)) as unknown as LivePptxSession;
  }

  function snapshotOf(session: RuntimeSession): PptxDeckSnapshot {
    return { revision: session.revision, edits: session.journal.slice(0, session.cursor).map(encodePptxEdit) };
  }

  /** Structural checks every snapshot must pass. The runtime advances the
   * revision once per applied edit, so a revision that disagrees with the
   * journal length is internally inconsistent (F6) - refused, never replayed. */
  function validSnapshot(snapshot: PptxDeckSnapshot): boolean {
    if (!Number.isSafeInteger(snapshot.revision) || snapshot.revision < 0) return false;
    if (!Array.isArray(snapshot.edits)) return false;
    return snapshot.revision === snapshot.edits.length;
  }

  /** Compare the first `count` live-journal entries against the snapshot's
   * entries, canonically (base64 byte fields included). */
  function prefixEqual(session: RuntimeSession, edits: readonly PptxJournalEntry[], count: number): boolean {
    for (let i = 0; i < count; i += 1) {
      if (stableJson(encodePptxEdit(session.journal[i] as PptxEdit)) !== stableJson(edits[i])) return false;
    }
    return true;
  }

  /** Serialize direction: the snapshot must be a prefix of what the model
   * currently holds (journal[0..cursor-1]) - a save may not carry edits the
   * model never applied, and after an undo the redo tail is not applied. */
  function snapshotIsJournalPrefix(session: RuntimeSession, snapshot: PptxDeckSnapshot): boolean {
    if (!validSnapshot(snapshot) || snapshot.edits.length > session.cursor) return false;
    return prefixEqual(session, snapshot.edits, snapshot.edits.length);
  }

  /** Restore direction (F1): the live journal must be the snapshot's own
   * prefix, so a recovered draft replays only the tail. On a fresh open the
   * journal is empty and every snapshot with edits passes here. */
  function journalIsSnapshotPrefix(session: RuntimeSession, snapshot: PptxDeckSnapshot): boolean {
    if (!validSnapshot(snapshot) || session.journal.length > snapshot.edits.length) return false;
    return prefixEqual(session, snapshot.edits, session.journal.length);
  }

  return {
    async open({ bytes, documentId }) {
      return serializeOperation(async () => {
        const outcome = await engineAdapter().open({ bytes, format: "pptx", document_id: documentId });
        if (outcome.outcome !== "opened") {
          return {
            outcome: "failed" as const,
            document_id: outcome.document_id,
            ...(outcome.failure_class ? { failure_class: outcome.failure_class } : {}),
            ...(outcome.message ? { message: outcome.message } : {}),
            ...(outcome.engine_error ? { engine_error: outcome.engine_error } : {}),
          };
        }
        const session: RuntimeSession = { ref: outcome.document_model_ref, journal: [], revision: 0, cursor: 0, baseBytes: bytes };
        sessions.set(session.ref, session);
        engineRefs.set(session.ref, session.ref);
        return {
          outcome: "opened" as const,
          document_id: documentId,
          document_model_ref: session.ref,
          snapshot: snapshotOf(session),
          warnings: outcome.warnings,
        };
      });
    },

    async edit(documentModelRef, edits) {
      return serializeOperation(() => {
        const session = requireSession(documentModelRef);
        // A fresh edit after an undo drops the redo tail (text-editor behavior).
        if (session.cursor < session.journal.length) session.journal.splice(session.cursor);
        let revision = session.revision;
        for (const edit of edits) {
          revision = applyEntry(documentModelRef, edit);
          session.journal.push(edit);
        }
        session.cursor = session.journal.length;
        session.revision = revision;
        return { revision };
      });
    },

    snapshot(documentModelRef) {
      return snapshotOf(requireSession(documentModelRef));
    },

    async restore(documentModelRef, snapshot) {
      return serializeOperation(() => {
        const session = requireSession(documentModelRef);
        // A recovered draft supersedes any local redo tail: the model only holds
        // journal[0..cursor-1], so the comparison and replay must ignore the
        // undone entries (a tail left over from an undo before recovery).
        if (session.cursor < session.journal.length) session.journal.splice(session.cursor);
        if (!journalIsSnapshotPrefix(session, snapshot)) throw new Error("pptx_restore_diverged");
        for (let i = session.journal.length; i < snapshot.edits.length; i += 1) {
          const edit = decodePptxEdit(snapshot.edits[i] as PptxJournalEntry);
          session.revision = applyEntry(documentModelRef, edit);
          session.journal.push(edit);
        }
        session.cursor = session.journal.length;
      });
    },

    async undo(documentModelRef) {
      return serializeOperation(async () => {
        const session = requireSession(documentModelRef);
        if (session.cursor === 0) return false;
        const nextCursor = session.cursor - 1;
        // Reopen the base package and replay the journal up to (not including)
        // the undone entry, so the model holds exactly the after-undo deck and a
        // later save serializes a genuine prefix of the journal. Reopening mid
        // session is feasible: the engine open is just another lane operation.
        const reopened = await engineAdapter().open({ bytes: session.baseBytes, format: "pptx", document_id: documentModelRef });
        if (reopened.outcome !== "opened" || !reopened.document_model_ref) throw new Error("pptx_undo_replay_failed");
        const previous = currentEngineRef(documentModelRef);
        engineRefs.set(documentModelRef, reopened.document_model_ref);
        engineAdapter().release(previous);
        let revision = 0;
        for (let i = 0; i < nextCursor; i += 1) revision = applyEntry(documentModelRef, session.journal[i] as PptxEdit);
        session.cursor = nextCursor;
        session.revision = revision;
        return true;
      });
    },

    async redo(documentModelRef) {
      return serializeOperation(() => {
        const session = requireSession(documentModelRef);
        if (session.cursor >= session.journal.length) return false;
        // The live model already holds journal[0..cursor-1]; replaying the next
        // entry forward is the whole redo.
        session.revision = applyEntry(documentModelRef, session.journal[session.cursor] as PptxEdit);
        session.cursor += 1;
        return true;
      });
    },

    async serialize(documentModelRef, { snapshot, signal }) {
      return serializeOperation(async () => {
        // The save never starts (and never reports success) once the caller
        // has aborted: a queued save that was cancelled must not mint bytes.
        signal?.throwIfAborted();
        const session = requireSession(documentModelRef);
        if (!snapshotIsJournalPrefix(session, snapshot.value)) throw new Error("pptx_save_snapshot_invalid");
        // The live engine session (not the runtime ref) is what holds the model;
        // undo swaps it, so the save must serialize the current one.
        const out = await engineAdapter().serialize({ document_model_ref: currentEngineRef(documentModelRef), format: "pptx" });
        signal?.throwIfAborted();
        return { bytes: out.bytes, checksum: out.checksum, warnings: out.warnings };
      });
    },

    deck(documentModelRef) {
      // Return the REAL opened deck: `opened.deck` carries the EMU `size` and
      // the live `slides`; the PptxSessionModel wrapper only proxies `slides`
      // and has no `size`, which made the canvas fall back to 16:9.
      return liveSession(documentModelRef).model.opened.deck as unknown as PptxDeckModel;
    },

    slideNotes(documentModelRef, slideIndex) {
      // The adapter resolves the slide's part path from the LIVE deck and
      // reads the notes part off the live archive, so an undo's reopen is
      // reflected exactly like deck()/slides(). A released session refuses
      // through currentEngineRef (pptx_runtime_not_open).
      return engineAdapter().slideNotes(currentEngineRef(documentModelRef), slideIndex);
    },

    slides(documentModelRef) {
      const slides = liveSession(documentModelRef).model.opened.deck.slides ?? [];
      return slides.map((slide, index) => ({
        id: slide.id ?? String(index),
        hidden: slide.hidden === true,
        elements: (slide.elements ?? []).map((element) => ({ id: element.id ?? "", type: element.type ?? "unknown" })),
      }));
    },

    async release(documentModelRef) {
      return serializeOperation(() => {
        sessions.delete(documentModelRef);
        const engineRef = engineRefs.get(documentModelRef);
        engineRefs.delete(documentModelRef);
        if (engineRef) engineAdapter().release(engineRef);
      });
    },
  };
}

// UNI-927 D1 - the desktop PPTX runtime.
//
// A desktop-hosted copy of the web runtime (apps/web/platform/office/pptx-runtime.ts):
// the renderer cannot import the web host graph, and the runtime's only
// dependencies are the generated pptx browser artifact and office-engine's
// PptxAdapter, both browser-safe. Open/edit/serialize run in the renderer; the
// main process owns the file/cloud write behind the validated IPC seam.
import {
  annotatePptxReplayRefs,
  bindPptxEngine,
  bindPptxOps,
  bindPptxRender,
  createPptxAdapter,
  isSlideHidden,
  type MasterElementData,
  type MasterPartInfo,
  pptxSessionDivergedError,
  rebasePptxJournal,
  resolvePptxReplayRefs,
  type PptxAdapter,
  type PptxEdit,
  type PptxReplayDeck,
  type PptxSlideAnimationRead,
  type PptxSlideTransitionRead,
} from "@uniwork/office-engine/pptx";
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

/** The generated artifact's optional master/layout part parser (the Masters
 * panel's element read). Same contract as the notes read: undefined until
 * shims/pptx-renderer-entry.ts re-exports parseMasterPart, and the adapter then
 * refuses masterElements with a typed master_unbound, never an invented list. */
const upstreamMasterParse = typeof (pptxUpstream as { parseMasterPart?: unknown }).parseMasterPart === "function"
  ? (pptxUpstream as unknown as { parseMasterPart: NonNullable<Parameters<typeof bindPptxEngine>[0]["parseMasterPart"]> }).parseMasterPart
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
  /** `createdIds` lists the element ids the edits minted (add_element, add_table, ...), in edit order. */
  edit(documentModelRef: string, edits: readonly PptxEdit[]): Promise<{ revision: number; createdIds?: string[] }>;
  snapshot(documentModelRef: string): PptxDeckSnapshot;
  /** Replay a recovered draft journal onto the freshly opened base. */
  restore?(documentModelRef: string, snapshot: PptxDeckSnapshot): Promise<void>;
  /** Journal-backed undo: reopen the base bytes and replay journal[0..cursor-1].
   *  Returns false at the base (nothing left to undo). */
  undo(documentModelRef: string): Promise<boolean>;
  /** Journal-backed redo: replay the entry the last undo removed. Returns false
   *  when the journal is already at its tip. */
  redo(documentModelRef: string): Promise<boolean>;
  /** `intentId` names the Save these bytes are for, so setBaseRevision can
   *  rebase onto exactly them once that Save commits. */
  serialize(
    documentModelRef: string,
    input: { snapshot: StableSnapshot<PptxDeckSnapshot>; intentId?: string; signal?: AbortSignal },
  ): Promise<PptxRuntimeSerializedOutput>;
  /** A Save committed the bytes serialize produced for `intentId`: they become
   *  the base and the journal keeps only the entries after them (W14). The
   *  xlsx runtime's commit hook, called by the save transport's commit. */
  setBaseRevision?(documentModelRef: string, revision: string, intentId: string): Promise<void>;
  /** The Save for `intentId` settled WITHOUT committing (terminal refusal,
   *  conflict, proven-uncommitted): the undo hold on its prefix ends. A Save the
   *  coordinator keeps for retry never calls this - the hold must stay. */
  releaseSave?(documentModelRef: string, intentId: string): Promise<void>;
  slides(documentModelRef: string): PptxSlideSummary[];
  /** The opened engine deck the shared canvas renders (EMU size included). */
  deck(documentModelRef: string): PptxDeckModel;
  /** Speaker-notes text of one slide of the LIVE engine session ('' when the
   * slide carries none). Optional on the seam so a hand-built test double that
   * predates this read stays assignable; both shipped runtimes implement it. */
  slideNotes?(documentModelRef: string, slideIndex: number): string;
  /** Transition + auto-advance of a LIVE slide (X1). Optional like slideNotes. */
  slideTransition?(documentModelRef: string, slideIndex: number): PptxSlideTransitionRead;
  /** Animation timeline of a LIVE slide, in play order (X1). Optional like slideNotes. */
  slideAnimations?(documentModelRef: string, slideIndex: number): PptxSlideAnimationRead[];
  /** Slide layouts of the LIVE package ([] when the engine binds no layout read). Optional like slideNotes. */
  slideLayouts?(documentModelRef: string): { name: string; path: string }[];
  /** Slide masters and layouts of the LIVE engine session (the Masters panel
   * part list). Optional like slideNotes: a hand-built test double that predates
   * this read stays assignable; the shipped runtime implements it. */
  masterParts?(documentModelRef: string): MasterPartInfo[];
  /** The editable elements of one master/layout part of the LIVE session. A part
   * path the deck does not carry is a typed engine refusal (bad_master_part). */
  masterElements?(documentModelRef: string, partPath: string): MasterElementData[];
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
          /** The real engine marks a hidden slide as show="0" on the <p:sld> tag in here; it never sets `hidden`. */
          bodyPrefix?: string;
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
  /** History step boundaries: the journal length after each edit() call (and
   * after each replayed draft entry), ascending. One undo/redo moves the cursor
   * across one step, so a multi-entry batch is one gesture in history. The
   * cursor is always 0 or one of these. Session-only: the snapshot stays a flat
   * entry journal, so draft recovery and validSnapshot are unchanged. */
  steps: number[];
  /** The base package (the opened bytes, then the last committed Save's);
   *  undo/redo replay the journal onto it. */
  baseBytes: Uint8Array;
  /** The engine model's revision at the base: a rebase without a reopen keeps
   *  the engine counting, so runtime revision = engine revision - engineBase. */
  engineBase: number;
  /** The bytes the in-flight Save serialized and the journal prefix they hold.
   *  Undo stops at that prefix until the Save settles: a retry of the intent
   *  needs it applied, and a commit rebases onto it. One at a time, since an
   *  overlapping Save is refused upstream. */
  pending?: { intentId: string; bytes: Uint8Array; edits: PptxJournalEntry[] };
  /** The last commit applied, so a repeated setBaseRevision is a no-op. */
  committed?: { intentId: string; revision: string };
  /** Set when a replay failed after the engine session was swapped: the
   * model no longer matches the journal, so every later edit, history move,
   * restore and save refuses with this (pptx_session_diverged) instead of
   * serializing a truncated deck. Snapshot still reads the intended journal. */
  diverged?: Error;
}

/** A bare Error carries no `code`, so the error table would file it under
 * office_unknown_error; the code is the message, like the engine's refusals. */
function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
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
        ...(upstreamMasterParse ? { parseMasterPart: upstreamMasterParse } : {}),
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

  /** A session that may still be edited, moved through history or saved. */
  function requireLive(ref: string): RuntimeSession {
    const session = requireSession(ref);
    if (session.diverged) throw session.diverged;
    return session;
  }

  /** The engine session ref currently backing a runtime ref (undo swaps it). */
  function currentEngineRef(ref: string): string {
    const engineRef = engineRefs.get(ref);
    if (!engineRef) throw new Error("pptx_runtime_not_open");
    return engineRef;
  }

  function liveDeck(ref: string): PptxReplayDeck {
    return liveSession(ref).model.opened.deck as PptxReplayDeck;
  }

  /** Apply one already-decoded journal entry on the live engine session. Its
   * recorded element positions resolve to this session's ids first: engine ids
   * are session-scoped, so a replay onto a reopened base needs them (W12). */
  function applyEntry(ref: string, entry: PptxEdit): { revision: number; createdId?: string } {
    const edit = resolvePptxReplayRefs(liveDeck(ref), entry);
    const { revision, createdId } = engineAdapter().edit(currentEngineRef(ref), edit);
    return { revision: revision - requireSession(ref).engineBase, ...(createdId ? { createdId } : {}) };
  }

  /** Reopen the base package into a fresh engine session and replay
   * journal[0..count-1] onto it; returns the engine revision it ends at. Throws
   * before the engine ref is swapped when the reopen itself fails. A replay
   * failure after the swap poisons the session (the old model is gone). */
  async function rebuildFromBase(ref: string, session: RuntimeSession, count: number): Promise<number> {
    const reopened = await engineAdapter().open({ bytes: session.baseBytes, format: "pptx", document_id: ref });
    if (reopened.outcome !== "opened" || !reopened.document_model_ref) throw new Error("pptx_undo_replay_failed");
    const previous = currentEngineRef(ref);
    engineRefs.set(ref, reopened.document_model_ref);
    engineAdapter().release(previous);
    session.engineBase = 0;
    let revision = 0;
    try {
      for (let i = 0; i < count; i += 1) revision = applyEntry(ref, session.journal[i] as PptxEdit).revision;
    } catch (error) {
      session.diverged = pptxSessionDivergedError(error);
      throw session.diverged;
    }
    return revision;
  }

  /** Apply a batch all-or-nothing (W10 review F1). A per-entry engine refusal
   * after k > 0 entries landed rolls the model back to journal[0..cursor-1] by
   * the same reopen-and-replay undo uses, then rethrows the original error, so
   * the failed gesture leaves no trace and journal, cursor, revision and model
   * agree. Should the rollback's reopen fail (the old engine session still
   * holds the applied prefix), `adopt` records that prefix as a step instead,
   * which is still a self-consistent history. A rollback whose replay fails
   * after the swap poisons the session and rejects with that instead.
   * `record` (fresh caller edits) stamps each entry's element positions on the
   * deck it is about to apply to; journaled entries (redo) already carry them. */
  async function applyAll(
    ref: string,
    session: RuntimeSession,
    edits: readonly PptxEdit[],
    record: boolean,
    adopt: (entries: readonly PptxEdit[], revision: number) => void,
  ): Promise<{ revision: number; createdIds: string[]; entries: PptxEdit[] }> {
    let revision = session.revision;
    const entries: PptxEdit[] = [];
    const createdIds: string[] = [];
    try {
      for (const edit of edits) {
        const entry = record ? annotatePptxReplayRefs(liveDeck(ref), edit) : edit;
        const result = applyEntry(ref, entry);
        revision = result.revision;
        entries.push(entry);
        if (result.createdId) createdIds.push(result.createdId);
      }
    } catch (error) {
      if (entries.length > 0) {
        const before = currentEngineRef(ref);
        try {
          session.revision = await rebuildFromBase(ref, session, session.cursor);
        } catch {
          if (currentEngineRef(ref) === before) adopt(entries, revision);
        }
      }
      throw session.diverged ?? error;
    }
    return { revision, createdIds, entries };
  }

  /** Drop the redo tail (text-editor behavior) and append one history step. */
  function commitStep(session: RuntimeSession, entries: readonly PptxEdit[], revision: number): void {
    session.journal.splice(session.cursor);
    session.steps = session.steps.filter((step) => step <= session.cursor);
    session.journal.push(...entries);
    session.cursor = session.journal.length;
    session.steps.push(session.cursor);
    session.revision = revision;
  }

  function liveSession(ref: string): LivePptxSession {
    return engineAdapter().sessionOf(currentEngineRef(ref)) as unknown as LivePptxSession;
  }

  /** The serialized-entry equality both prefix guards and the rebase use. */
  function sameEntry(live: PptxEdit, entry: unknown): boolean {
    return stableJson(encodePptxEdit(live)) === stableJson(entry);
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
      if (!sameEntry(session.journal[i] as PptxEdit, edits[i])) return false;
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
        const session: RuntimeSession = { ref: outcome.document_model_ref, journal: [], revision: 0, cursor: 0, steps: [], baseBytes: bytes, engineBase: 0 };
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
      return serializeOperation(async () => {
        const session = requireLive(documentModelRef);
        const { revision, createdIds, entries } = await applyAll(documentModelRef, session, edits, true, (applied, at) => {
          commitStep(session, applied, at);
        });
        // One edit() call is one history step; the redo tail drops only once
        // the whole batch landed, so a refused batch keeps the redo path.
        if (entries.length > 0) commitStep(session, entries, revision);
        return { revision, ...(createdIds.length ? { createdIds } : {}) };
      });
    },

    snapshot(documentModelRef) {
      return snapshotOf(requireSession(documentModelRef));
    },

    async restore(documentModelRef, snapshot) {
      return serializeOperation(() => {
        const session = requireLive(documentModelRef);
        // A recovered draft supersedes any local redo tail: the model only holds
        // journal[0..cursor-1], so the comparison and replay must ignore the
        // undone entries (a tail left over from an undo before recovery).
        if (session.cursor < session.journal.length) session.journal.splice(session.cursor);
        session.steps = session.steps.filter((step) => step <= session.cursor);
        if (!journalIsSnapshotPrefix(session, snapshot)) throw new Error("pptx_restore_diverged");
        // The draft carries no step grouping, so each replayed entry is its own
        // step; journal, cursor and revision advance together per entry, so a
        // refusal mid-replay leaves the replayed prefix as a valid history.
        for (let i = session.journal.length; i < snapshot.edits.length; i += 1) {
          const edit = decodePptxEdit(snapshot.edits[i] as PptxJournalEntry);
          commitStep(session, [edit], applyEntry(documentModelRef, edit).revision);
        }
      });
    },

    async undo(documentModelRef) {
      return serializeOperation(async () => {
        const session = requireLive(documentModelRef);
        // Never below the in-flight Save's prefix (see `pending`), nor below
        // the base: after a commit the base IS the saved deck, so undo cannot
        // cross a save point - the docx/xlsx rule (their models rebase too).
        if (session.cursor <= (session.pending?.edits.length ?? 0)) return false;
        // The previous step boundary: one undo reverts one edit() call.
        const nextCursor = session.steps.filter((step) => step < session.cursor).at(-1) ?? 0;
        // Reopen the base package and replay the journal up to (not including)
        // the undone step, so the model holds exactly the after-undo deck and a
        // later save serializes a genuine prefix of the journal. Reopening mid
        // session is feasible: the engine open is just another lane operation.
        session.revision = await rebuildFromBase(documentModelRef, session, nextCursor);
        session.cursor = nextCursor;
        return true;
      });
    },

    async redo(documentModelRef) {
      return serializeOperation(async () => {
        const session = requireLive(documentModelRef);
        const next = session.steps.find((step) => step > session.cursor);
        if (next === undefined) return false;
        // The live model already holds journal[0..cursor-1]; replaying the next
        // step's entries forward is the whole redo (all-or-nothing like edit).
        const { revision } = await applyAll(documentModelRef, session, session.journal.slice(session.cursor, next), false, (applied, at) => {
          session.cursor += applied.length;
          session.steps = [...session.steps.filter((step) => step < session.cursor), session.cursor, ...session.steps.filter((step) => step > session.cursor)];
          session.revision = at;
        });
        session.cursor = next;
        session.revision = revision;
        return true;
      });
    },

    async serialize(documentModelRef, { snapshot, intentId, signal }) {
      return serializeOperation(async () => {
        // The save never starts (and never reports success) once the caller
        // has aborted: a queued save that was cancelled must not mint bytes.
        signal?.throwIfAborted();
        const session = requireLive(documentModelRef);
        if (!snapshotIsJournalPrefix(session, snapshot.value)) throw new Error("pptx_save_snapshot_invalid");
        // The live engine session (not the runtime ref) is what holds the model;
        // undo swaps it, so the save must serialize the current one.
        const out = await engineAdapter().serialize({ document_model_ref: currentEngineRef(documentModelRef), format: "pptx" });
        signal?.throwIfAborted();
        // The bytes hold the live model, journal[0..cursor-1] - possibly more
        // than the snapshot (typing queued ahead of this save on the lane).
        // That cursor, captured here and not at commit time, is what a commit
        // rebases away; later typing stays as the journal tail.
        if (intentId) session.pending = { intentId, bytes: out.bytes.slice(), edits: session.journal.slice(0, session.cursor).map(encodePptxEdit) };
        return { bytes: out.bytes, checksum: out.checksum, warnings: out.warnings };
      });
    },

    async setBaseRevision(documentModelRef, revision, intentId) {
      return serializeOperation(() => {
        const session = requireLive(documentModelRef);
        if (session.committed?.intentId === intentId && session.committed.revision === revision) return;
        const pending = session.pending;
        if (pending?.intentId !== intentId) throw codedError("pptx_commit_candidate_missing");
        // Undo stops at the pending prefix, so the live history still holds it;
        // a miss means the history and the saved bytes share no base.
        if (!rebasePptxJournal(session, pending.edits, sameEntry)) throw codedError("pptx_save_rebase_diverged");
        // The live engine model stays: it holds base + journal, which is the
        // saved deck + tail. Only its revision counter keeps running.
        session.engineBase += pending.edits.length;
        session.baseBytes = pending.bytes;
        session.pending = undefined;
        session.committed = { intentId, revision };
      });
    },

    async releaseSave(documentModelRef, intentId) {
      return serializeOperation(() => {
        // A released or unknown session has nothing left to hold.
        const session = sessions.get(documentModelRef);
        if (session?.pending?.intentId === intentId) session.pending = undefined;
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

    slideTransition(documentModelRef, slideIndex) {
      return engineAdapter().slideTransition(currentEngineRef(documentModelRef), slideIndex);
    },

    slideAnimations(documentModelRef, slideIndex) {
      return engineAdapter().slideAnimations(currentEngineRef(documentModelRef), slideIndex);
    },

    slideLayouts(documentModelRef) {
      return engineAdapter().slideLayouts(currentEngineRef(documentModelRef));
    },

    masterParts(documentModelRef) {
      // Read off the LIVE engine session like slideNotes, so an undo reopen is
      // reflected and a released session refuses (pptx_runtime_not_open).
      return engineAdapter().masterParts(currentEngineRef(documentModelRef));
    },

    masterElements(documentModelRef, partPath) {
      return engineAdapter().masterElements(currentEngineRef(documentModelRef), partPath);
    },

    slides(documentModelRef) {
      const slides = liveSession(documentModelRef).model.opened.deck.slides ?? [];
      return slides.map((slide, index) => ({
        id: slide.id ?? String(index),
        hidden: isSlideHidden(slide),
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

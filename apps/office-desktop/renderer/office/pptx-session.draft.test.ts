/** @vitest-environment node */
// UNI-927 W15 (W14 review F1, F2): the desktop pptx session over the REAL
// runtime and adapter (only the generated pptx artifact is the office-engine
// fake) and an in-memory draft store behind the bridge. A checkpoint that waits
// on a committing Save must store the post-rebase TAIL under the new base, never
// the pre-rebase journal.
import { describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import type { OpenedPptxLike, PptxEdit, PptxTxnRequest } from "@uniwork/office-engine/pptx";
import { makeFakePptxBytes } from "../../../../packages/office-engine/test/fake-pptx-fixtures";
import { createDesktopPptxAdapter, type DesktopPptxAdapter } from "./pptx-adapter";
import { createWebPptxSessionRuntime } from "./pptx-runtime";
import { createPptxDocumentSession } from "./pptx-session";
import type { LibraryBridge } from "../library/model";

vi.mock("@uniwork/office-upstream/pptx-renderer", async () => {
  const fakes = await import("../../../../packages/office-engine/test/fake-pptx-engine");
  const engine = fakes.createFakePptxEngine();
  const ops = fakes.createFakePptxOps();
  return {
    openPptx: (bytes: Uint8Array) => engine.openPptx(bytes),
    savePptx: (opened: OpenedPptxLike) => engine.savePptx(opened),
    commitSaved: (opened: OpenedPptxLike) => engine.commitSaved?.(opened),
    reparseDeck: (opened: OpenedPptxLike) => engine.reparseDeck?.(opened) ?? opened,
    listSlideLayouts: (archive: unknown) => engine.listSlideLayouts?.(archive) ?? [],
    runTxn: (opened: OpenedPptxLike, request: PptxTxnRequest) => ops.runTxn(opened, request),
    getSlideNotes: () => "",
    buildRenderSlide: () => ({ nodes: [] }),
    HeuristicMetrics: class HeuristicMetrics {},
    parseMasterPart: () => null,
  };
});

const CHECKSUM = `sha256:${"a".repeat(64)}`;
const identity: OfficeIdentity = { deploymentId: "lane", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId: "doc", generation: 1, baseRevision: "2", baseVersionId: "v2" };
const capability = { format: "pptx", operation: "edit", host: "desktop", engineBuild: "t", contractRevision: "office-editor-host/1", status: "available", fidelityWarnings: [] } as never;
const box = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 1, wPx: 10, hPx: 10 });
const toBase64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");

interface StoredDraft { draftId: string; generation: number; dataBase64: string }

/** The main-process side: drafts keyed by id, and a cloud save held open on demand. */
function fakeMain() {
  const drafts = new Map<string, StoredDraft>();
  const gate: { hold: boolean; entered: boolean; release: () => void; saved: string | null } = { hold: false, entered: false, release: () => undefined, saved: null };
  const meta = (stored: StoredDraft) => {
    const [documentId, version, revision] = stored.draftId.split(":") as [string, string, string];
    return { draftId: stored.draftId, identity: { deploymentId: "lane", accountId: "acct", organizationId: "org", workspaceId: "ws", documentId, base: { revision, version } }, generation: stored.generation, checksum: CHECKSUM, byteLength: stored.dataBase64.length, updatedAt: stored.generation };
  };
  const bridge: LibraryBridge = {
    call: (async (channel: string, payload: Record<string, unknown>) => {
      switch (channel) {
        case "desktop:draft-list": return { drafts: [...drafts.values()].map(meta) };
        case "desktop:draft-checkpoint": {
          const stored = { draftId: payload.draftId as string, generation: payload.generation as number, dataBase64: payload.dataBase64 as string };
          drafts.set(stored.draftId, stored);
          return { stored: true, generation: stored.generation };
        }
        case "desktop:draft-discard": return { discarded: drafts.delete(payload.draftId as string) };
        case "desktop:draft-recover": {
          const stored = drafts.get(payload.draftId as string);
          return stored ? { status: "recovered", metadata: meta(stored), dataBase64: stored.dataBase64 } : { status: "missing" };
        }
        case "desktop:office-save": {
          gate.saved = payload.dataBase64 as string;
          if (gate.hold) {
            gate.entered = true;
            await new Promise<void>((resolve) => { gate.release = resolve; });
          }
          return { documentId: "doc", intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, versionId: "v3", revision: "3", checksum: payload.checksum };
        }
        default: throw new Error(`unexpected ${channel}`);
      }
    }) as LibraryBridge["call"],
  } as LibraryBridge;
  return { drafts, gate, bridge };
}

function openSession(bridge: LibraryBridge, bytes: Uint8Array, base: Pick<OfficeIdentity, "baseRevision" | "baseVersionId">) {
  const captures: { count: number; hold: Promise<void> | null; held: boolean } = { count: 0, hold: null, held: false };
  let adapter!: DesktopPptxAdapter;
  const session = createPptxDocumentSession(bridge, { ...identity, ...base }, { format: "pptx", dataBase64: toBase64(bytes), checksum: CHECKSUM }, (onDirty) => {
    adapter = createDesktopPptxAdapter({ identity, runtime: createWebPptxSessionRuntime({ documentId: "doc" }), readBytes: async () => bytes, capability, onDirty });
    const capture = adapter.editor.captureSnapshot.bind(adapter.editor);
    adapter.editor.captureSnapshot = async () => {
      const value = await capture();
      captures.count += 1;
      // One-shot: the snapshot is read now but resolves only when released.
      const hold = captures.hold;
      if (hold) { captures.hold = null; captures.held = true; await hold; }
      return value;
    };
    return adapter;
  });
  return { session, captures };
}

const elementCount = (session: { editor: { slides(): Array<{ elements: unknown[] }> } }) => session.editor.slides()[0]?.elements.length ?? 0;

describe("desktop pptx session - mid-save checkpoint (W14 review F1)", () => {
  it.each(["checkpoint", "keepDraft"] as const)("%s waiting on a committing Save stores the tail under the new base, and recovery never double-applies", async (entry) => {
    const main = fakeMain();
    const { session, captures } = openSession(main.bridge, makeFakePptxBytes(), { baseRevision: "2", baseVersionId: "v2" });
    await session.openEditor();
    const baseCount = elementCount(session);
    await session.editor.edit([box(1)]);
    await session.editor.edit([box(2)]);

    main.gate.hold = true;
    const saving = session.coordinator.save("button");
    await vi.waitFor(() => expect(main.gate.entered).toBe(true));
    // Typing after the save intent's snapshot, then a checkpoint requested
    // while the commit is still in flight.
    await session.editor.edit([box(3)]);
    // The checkpoint queues behind the Save; no capture runs while it commits.
    const waiting = entry === "checkpoint" ? session.coordinator.checkpoint() : session.keepDraft();
    main.gate.release();
    await expect(saving).resolves.toMatchObject({ accepted: true, receipt: { revision: "3" } });
    await waiting;

    // The runtime rebased onto the saved bytes: the journal is the tail only.
    expect(session.coordinator.getState().identity).toMatchObject({ baseRevision: "3", baseVersionId: "v3" });
    const tail = session.editor.snapshot();
    expect(tail?.revision).toBe(1);
    expect(tail?.edits).toHaveLength(1);

    // The stored draft under the NEW base is that tail - not the pre-rebase journal.
    const stored = main.drafts.get("doc:v3:3");
    expect(stored).toBeDefined();
    expect(JSON.parse(Buffer.from(stored!.dataBase64, "base64").toString("utf8"))).toEqual(tail);

    // Crash -> reopen the SAVED bytes at the new base -> recover: same deck, once.
    const savedBytes = Uint8Array.from(Buffer.from(main.gate.saved!, "base64"));
    const reopened = openSession(main.bridge, savedBytes, { baseRevision: "3", baseVersionId: "v3" });
    await reopened.session.openEditor();
    expect(elementCount(reopened.session)).toBe(baseCount + 2);
    const found = await reopened.session.listDrafts();
    expect(found).toMatchObject({ status: "found", conflict: false });
    if (found.status !== "found") throw new Error("expected a draft");
    await expect(reopened.session.recoverDraft(found.metadata)).resolves.toBe("recovered");
    expect(elementCount(reopened.session)).toBe(baseCount + 3);
    expect(elementCount(reopened.session)).toBe(elementCount(session));
    expect(reopened.session.editor.snapshot()).toEqual(tail);
  });
});

describe("desktop pptx session - capture that resolves after the Save (T09 settle gate)", () => {
  it("a checkpoint capture read before the rebase but resolved after the Save is captured again, never stored pre-rebase", async () => {
    const main = fakeMain();
    const { session, captures } = openSession(main.bridge, makeFakePptxBytes(), { baseRevision: "2", baseVersionId: "v2" });
    await session.openEditor();
    await session.editor.edit([box(1)]);
    await session.editor.edit([box(2)]);
    main.gate.hold = true;
    const saving = session.coordinator.save("button");
    await vi.waitFor(() => expect(main.gate.entered).toBe(true));
    await session.editor.edit([box(3)]);
    // The coordinator's own capture reads the full pre-rebase journal and is
    // held until after the Save settled (a digest yields to the event loop).
    let releaseCapture!: () => void;
    captures.hold = new Promise<void>((resolve) => { releaseCapture = resolve; });
    const checkpointing = session.coordinator.checkpoint();
    await vi.waitFor(() => expect(captures.held).toBe(true));
    main.gate.release();
    await expect(saving).resolves.toMatchObject({ accepted: true, receipt: { revision: "3" } });
    releaseCapture();
    await checkpointing;

    const tail = session.editor.snapshot();
    expect(tail?.edits).toHaveLength(1);
    const stored = main.drafts.get("doc:v3:3");
    expect(stored).toBeDefined();
    expect(JSON.parse(Buffer.from(stored!.dataBase64, "base64").toString("utf8"))).toEqual(tail);
  });
});

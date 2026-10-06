/** @vitest-environment jsdom */
// UNI-940 X02 r2: both desktop XLSX sessions (cloud + local file) across the
// host journal apply path and a save boundary. Visual ops ride edit() to the
// save job untouched, and the draft op stream (F4) holds exactly the edits the
// committed file does not: the ones typed during the in-flight save and after.
import { describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import { diffXlsxSnapshotsToOperations } from "@uniwork/views/office/xlsx";
import { createDesktopLocalXlsxSession } from "./xlsx-local-session";
import { createDesktopXlsxSession } from "./xlsx-session";

const HANDLE = "file_" + "b".repeat(32);
const workbook = (a1 = 1) => ({ revision: 0, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: a1 } } }] });
const renderModel = { revision: 1, activeTab: 0, date1904: false, styles: [], dxfStyles: [], sheets: [{ id: "sheet-1", name: "Data", rowCount: 2, columnCount: 2, cells: { A1: { v: 1 } }, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [] }] };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const anchor = (row: number) => ({ fromRow: row, fromColumn: 1, fromRowOffset: 0, fromColumnOffset: 0, toRow: row + 4, toColumn: 4, toRowOffset: 0, toColumnOffset: 0 });
const insert = { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor: anchor(1), image: { mediaType: "image/png", base64: "iVBORw0KGgo=" } } };
const move = { op: "set_visual", target: { sheet: "Data" }, attributes: { id: "v1", anchor: anchor(6) } };
const remove = { op: "remove_visual", target: { sheet: "Data" }, attributes: { id: "v1" } };
const cell = (address: string, value: number) => ({ op: "set_cell", target: { sheet: "Data", cell: address }, attributes: { value } });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

/** One bridge for both hosts: the cloud channels (office-job / office-save)
 *  and the local ones (file-xlsx / file-save). `hold` parks the save write so
 *  a test can type while it is in flight. */
function makeBridge(opened = workbook()) {
  let hold: Promise<void> | null = null;
  let refuseEdit: string | null = null;
  let holdEdit: Promise<void> | null = null;
  let modified = 1_000;
  const call = vi.fn(async (channel: string, payload: Record<string, unknown>) => {
    if (channel === "desktop:office-job" || channel === "desktop:file-xlsx") {
      // The local channel answers without the cloud job envelope fields.
      const job = channel === "desktop:office-job" ? { jobId: "job", documentId: "doc-j" } : {};
      if (payload.operation === "open") return { ...job, state: "completed", outputBase64: encode({ snapshot: opened, render_model: renderModel }) };
      if (holdEdit) await holdEdit;
      if (refuseEdit !== null) {
        const reason = refuseEdit;
        refuseEdit = null;
        // The cloud transport hands the refusal back as errorReason; the local channel throws the engine error.
        if (channel === "desktop:file-xlsx") throw new Error(`Error invoking remote method 'desktop:file-xlsx': XlsxTypedError: ${reason}`);
        return { ...job, state: "failed", errorReason: reason };
      }
      return { ...job, state: "completed", outputBase64: Buffer.from([1, 2, 3]).toString("base64"), outputChecksum: `sha256:${"a".repeat(64)}` };
    }
    if (channel === "desktop:office-save" || channel === "desktop:file-save") {
      if (hold) await hold;
      if (channel === "desktop:file-save") {
        modified += 1_000;
        return { opened: true, metadata: { handle: HANDLE, name: "Budget.xlsx", byteLength: 3, modifiedAtMs: modified, checksum: `sha256:${"a".repeat(64)}` } };
      }
      return { documentId: "doc-j", intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, versionId: "version-2", revision: "3", checksum: payload.checksum };
    }
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:draft-checkpoint") return { stored: true, generation: payload.generation };
    throw new Error("unexpected channel " + channel);
  });
  return { call, refuseNextEdit: (reason: string) => { refuseEdit = reason; }, holdSaves: (gate: Promise<void> | null) => { hold = gate; }, holdEdits: (gate: Promise<void> | null) => { holdEdit = gate; } };
}

const editJobs = (bridge: ReturnType<typeof makeBridge>) =>
  bridge.call.mock.calls.filter(([channel, payload]) => (channel === "desktop:office-job" || channel === "desktop:file-xlsx") && (payload as { operation: string }).operation === "edit").map(([, payload]) => (payload as { edits: unknown[] }).edits);

const hosts = {
  cloud: (bridge: ReturnType<typeof makeBridge>) => {
    const identity: OfficeIdentity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc-j", generation: 1, baseRevision: "2", baseVersionId: "1" };
    return createDesktopXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "2", baseVersionId: "1" });
  },
  local: (bridge: ReturnType<typeof makeBridge>) => {
    const identity: OfficeIdentity = { deploymentId: "local-device", accountId: "local:device", organizationId: "local", workspaceId: "local", documentId: HANDLE, generation: 1, baseRevision: "100", baseVersionId: "sha256:" + "0".repeat(64) };
    return createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
  },
};

describe.each(Object.entries(hosts))("desktop %s xlsx session journal", (_name, create) => {
  it("takes a visual insert, move and remove through edit() and sends them unchanged in the save job", async () => {
    const bridge = makeBridge();
    const session = create(bridge);
    await session.open.open();
    await session.editor.edit?.([insert]);
    await session.editor.edit?.([move]);
    await session.editor.edit?.([cell("A1", 5), remove]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect(await session.coordinator.save("button")).toMatchObject({ accepted: true });
    expect(editJobs(bridge)[0]).toEqual([insert, move, cell("A1", 5), remove]);
  });

  it("keeps the edits typed during an in-flight save in the draft stream, and drops the saved ones", async () => {
    const bridge = makeBridge();
    const session = create(bridge);
    await session.open.open();
    await session.editor.edit?.([cell("A1", 3)]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    const gate = deferred();
    bridge.holdSaves(gate.promise);
    const saving = session.coordinator.save("button");
    await vi.waitFor(() => expect(bridge.call.mock.calls.some(([channel]) => channel === "desktop:office-save" || channel === "desktop:file-save")).toBe(true));
    // Typed after the save's snapshot, before its commit lands.
    await session.editor.edit?.([cell("B2", 8), insert]);
    gate.resolve();
    bridge.holdSaves(null);
    expect(await saving).toMatchObject({ accepted: true });
    await session.editor.edit?.([cell("C3", 9)]);
    const draft = (await session.editor.captureSnapshot()).value as { pendingOps?: unknown[] };
    expect(draft.pendingOps).toEqual([cell("B2", 8), insert, cell("C3", 9)]);

    // Crash: a new window opens the saved file (A1 = 3) and replays the draft
    // the way recoverDraft does; the next save carries exactly the unsaved ops.
    const reopened = makeBridge(workbook(3));
    const restored = create(reopened);
    await restored.open.open();
    const recovered = JSON.parse(JSON.stringify(draft)) as Parameters<typeof diffXlsxSnapshotsToOperations>[1];
    await restored.editor.edit?.(diffXlsxSnapshotsToOperations(restored.editor.getWorkbookSnapshot!()!, recovered));
    restored.coordinator.markDirty(restored.editor.getDirtyGeneration());
    expect(await restored.coordinator.save("button")).toMatchObject({ accepted: true });
    expect(editJobs(reopened)[0]).toEqual([cell("B2", 8), insert, cell("C3", 9)]);
  });

  it("drops the refused rule-set op from the save and the draft stream, then commits the rest on the next Save", async () => {
    const bridge = makeBridge();
    const session = create(bridge);
    const cfOp = { op: "set_conditional_formats", target: { sheet: "Data" }, attributes: { rules: [] } };
    await session.open.open();
    await session.editor.edit?.([cfOp, cell("A1", 5)]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    bridge.refuseNextEdit('xlsx_rule_sets_dropped:[["cf",[0]]]');
    expect(await session.coordinator.save("button")).toEqual({ accepted: false, reason: "error" });
    expect(session.coordinator.getState()).toMatchObject({ state: "error", error: { code: "xlsx_rule_sets_dropped", retryable: false } });
    expect(session.editor.droppedRuleSets?.()).toEqual([{ family: "conditionalFormats", sheet: "Data", savedRules: null, rules: 0 }]);
    expect(((await session.editor.captureSnapshot()).value as { pendingOps?: unknown[] }).pendingOps).toEqual([cell("A1", 5)]);
    expect(await session.coordinator.save("button")).toMatchObject({ accepted: true });
    expect(editJobs(bridge)).toEqual([[cfOp, cell("A1", 5)], [cell("A1", 5)]]);
  });

  // UNI-953 item 3 + r4 R4-3: edits typed while the refused save ran, among
  // them a newer snapshot of the refused sheet, go out with ONE more Save.
  it("saves everything typed during a refused save with one more Save", async () => {
    const bridge = makeBridge();
    const session = create(bridge);
    const cfOp = { op: "set_conditional_formats", target: { sheet: "Data" }, attributes: { rules: [] } };
    const dvOp = { op: "set_data_validations", target: { sheet: "Data" }, attributes: { rules: [] } };
    await session.open.open();
    await session.editor.edit?.([cfOp, cell("A1", 5)]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    const gate = deferred();
    bridge.holdEdits(gate.promise);
    bridge.refuseNextEdit('xlsx_rule_sets_dropped:[["cf",[0]]]');
    const saving = session.coordinator.save("button");
    await vi.waitFor(() => expect(editJobs(bridge)).toHaveLength(1));
    await session.editor.edit?.([cell("B2", 8), cfOp, dvOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    gate.resolve();
    bridge.holdEdits(null);
    expect(await saving).toEqual({ accepted: false, reason: "error" });
    expect(await session.coordinator.save("button")).toMatchObject({ accepted: true });
    expect(editJobs(bridge).at(-1)).toEqual([cell("A1", 5), cell("B2", 8), dvOp]);
    expect(session.coordinator.getState().state).toBe("saved");
  });
});

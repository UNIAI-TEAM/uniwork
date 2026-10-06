/** @vitest-environment jsdom */
import i18n from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import { createDesktopLocalXlsxSession } from "./xlsx-local-session";

const HANDLE = "file_" + "a".repeat(32);
const identity: OfficeIdentity = { deploymentId: "local-device", accountId: "local:device", organizationId: "local", workspaceId: "local", documentId: HANDLE, generation: 1, baseRevision: "100", baseVersionId: "sha256:" + "0".repeat(64) };
const snapshot = { revision: 0, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 1 } } }] };
const renderModel = { revision: 1, activeTab: 0, date1904: false, styles: [], dxfStyles: [], sheets: [{ id: "sheet-1", name: "Data", rowCount: 2, columnCount: 2, cells: { A1: { v: 2 } }, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [] }] };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const editOp = { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } };

const ruleArea = { startRow: 1, endRow: 9, startColumn: 0, endColumn: 0 };
const cfRuleOp = { op: "set_conditional_formats", target: { sheet: "Data" }, attributes: { rules: [{ ranges: [ruleArea], stopIfTrue: false, rule: { type: "highlightCell", subType: "number", operator: "greaterThan", value: 10, style: { bg: { rgb: "#FFC7CE" } } } }] } };
const dvRuleOp = { op: "set_data_validations", target: { sheet: "Data" }, attributes: { rules: [{ ranges: [ruleArea], rule: { uid: "dv-1", type: "list", formula1: "Yes,No", allowBlank: true } }] } };

/** A local-file bridge that mirrors main: the engine job rides
 *  desktop:file-xlsx, the Save writes the opaque handle through
 *  desktop:file-save, and no cloud channel is ever reached. */
function makeLocalBridge() {
  const saved: Uint8Array[] = [];
  const call = vi.fn(async (channel: string, payload: Record<string, unknown>): Promise<Record<string, unknown>> => {
    if (channel === "desktop:file-xlsx") {
      if (payload.operation === "open") return { state: "completed", outputBase64: encode({ snapshot, render_model: renderModel }) };
      return { state: "completed", outputBase64: Buffer.from([1, 2, 3, 4]).toString("base64"), outputChecksum: `sha256:${"a".repeat(64)}` };
    }
    if (channel === "desktop:file-save") {
      saved.push(Uint8Array.from(Buffer.from(payload.dataBase64 as string, "base64")));
      return { opened: true, metadata: { handle: HANDLE, name: "Budget.xlsx", byteLength: 4, modifiedAtMs: 250, checksum: `sha256:${"a".repeat(64)}` } };
    }
    if (channel === "desktop:draft-list") return { drafts: [] };
    if (channel === "desktop:draft-checkpoint") return { stored: true, generation: payload.generation };
    throw new Error("unexpected channel " + channel);
  });
  return { call, saved };
}

describe("desktop local xlsx session (C1b)", () => {
  it("accepts a CF op and a DV op through edit() and sends both unchanged in the save job", async () => {
    const bridge = makeLocalBridge();
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await session.open.open();
    await session.editor.edit?.([cfRuleOp, dvRuleOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect(await session.coordinator.save("button")).toMatchObject({ accepted: true });
    expect(bridge.call).toHaveBeenCalledWith("desktop:file-xlsx", expect.objectContaining({ operation: "edit", edits: [cfRuleOp, dvRuleOp] }));
  });

  it("opens a local .xlsx through the main-owned engine job and exposes the workbook", async () => {
    const bridge = makeLocalBridge();
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    expect(await session.open.open()).toMatchObject({ outcome: "opened", document_id: HANDLE });
    expect(session.editor.getWorkbookSnapshot?.()?.sheets[0]?.name).toBe("Data");
    expect(bridge.call).toHaveBeenCalledWith("desktop:file-xlsx", expect.objectContaining({ handle: HANDLE, operation: "open" }));
  });

  // A build without the staged gateway answers engine_incompatible from main.
  // The open screen named it only "cannot open, retry"; it now gets its own
  // failure class so the user is told the build lacks the spreadsheet engine.
  it("types a missing local engine as engine_unavailable instead of a generic engine_error", async () => {
    const call = vi.fn(async () => { throw new Error("Error invoking remote method 'desktop:file-xlsx': EngineBoundaryError: engine_incompatible"); });
    const session = createDesktopLocalXlsxSession({ bridge: { call } as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    expect(await session.open.open()).toMatchObject({ outcome: "failed", failure_class: "engine_unavailable", engine_error: "engine_incompatible" });
  });

  it("keeps any other open failure an engine_error", async () => {
    const call = vi.fn(async () => { throw new Error("office_open_snapshot_invalid"); });
    const session = createDesktopLocalXlsxSession({ bridge: { call } as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    expect(await session.open.open()).toMatchObject({ outcome: "failed", failure_class: "engine_error" });
  });

  it("edits, saves through the local file command and reopens the saved bytes", async () => {
    const bridge = makeLocalBridge();
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect(session.editor.getWorkbookSnapshot?.()?.sheets[0]?.cells.A1).toEqual({ value: 7 });

    const result = await session.coordinator.save("button");
    expect(result.accepted).toBe(true);
    // Narrow the SaveAttemptResult union before reading the receipt: the
    // rejected branch has no receipt, so the reopen base revision is only
    // meaningful on the accepted branch.
    if (!result.accepted) throw new Error("expected the local save to be accepted");
    expect(bridge.call).toHaveBeenCalledWith("desktop:file-xlsx", expect.objectContaining({ operation: "edit", edits: [editOp] }));
    expect(bridge.call).toHaveBeenCalledWith("desktop:file-save", expect.objectContaining({ handle: HANDLE }));
    expect(bridge.saved).toHaveLength(1);
    expect(bridge.saved[0]).toEqual(Uint8Array.from([1, 2, 3, 4]));

    // Reopen: a fresh session reads the SAME handle through the engine job and
    // surfaces the workbook, proving the save/reopen loop is the local lane.
    const reopened = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: String(result.receipt.revision), baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    expect(await reopened.open.open()).toMatchObject({ outcome: "opened", document_id: HANDLE });
    expect(reopened.editor.getWorkbookSnapshot?.()?.sheets[0]?.name).toBe("Data");
  });

  // A build that staged the gateway but not the recalc sidecar refuses a
  // formula-bearing save in main. Electron's invoke rejection keeps only the
  // message, so the coordinator filed it as office_unknown_error; the session
  // now re-types it so the save banner can name the missing engine part.
  it("types a refused formula save as xlsx_recalc_unavailable instead of office_unknown_error", async () => {
    const bridge = makeLocalBridge();
    const local = bridge.call.getMockImplementation()!;
    bridge.call.mockImplementation(async (channel, payload) => {
      if (channel === "desktop:file-xlsx" && payload.operation === "edit") throw new Error("Error invoking remote method 'desktop:file-xlsx': Error: xlsx_recalc_unavailable");
      return local(channel, payload);
    });
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());

    expect((await session.coordinator.save("button")).accepted).toBe(false);
    expect(session.coordinator.getState().error).toMatchObject({ code: "xlsx_recalc_unavailable", errorClass: "engine", state: "error", retryable: false });
    expect(bridge.call).not.toHaveBeenCalledWith("desktop:file-save", expect.anything());
  });

  // Main answers a refused file with a typed code (a thrown code would not
  // survive Electron's invoke); the session hands it to the save status.
  it("carries a refused local file's code to the save error instead of office_unknown_error", async () => {
    const bridge = makeLocalBridge();
    const local = bridge.call.getMockImplementation()!;
    bridge.call.mockImplementation(async (channel, payload) => {
      if (channel === "desktop:file-save") return { opened: false, code: "file_changed_on_disk" };
      return local(channel, payload);
    });
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect((await session.coordinator.save("button")).accepted).toBe(false);
    expect(session.coordinator.getState().error).toMatchObject({ code: "file_changed_on_disk" });
  });
  it("types a failed local xlsx job by the code main answered", async () => {
    const bridge = makeLocalBridge();
    bridge.call.mockImplementation(async (channel) => channel === "desktop:file-xlsx" ? { state: "failed", code: "file_not_found" } : { drafts: [] });
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await expect(session.open.open()).resolves.toMatchObject({ outcome: "failed", engine_error: "file_not_found", message: i18n.t("office.save.reason.file_not_found") });
    expect(i18n.t("office.save.reason.file_not_found")).toMatch(/Không tìm thấy tệp/);
  });

  it("keeps a protected draft through the desktop draft IPC (local:<device>)", async () => {
    const bridge = makeLocalBridge();
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect(await session.keepDraft()).toBe(true);
    expect(bridge.call).toHaveBeenCalledWith("desktop:draft-checkpoint", expect.objectContaining({ documentId: HANDLE }));
  });

  it("drops refused rule sets from the save, keeps the cell edit and commits on the next explicit Save", async () => {
    const bridge = makeLocalBridge();
    const cfOp = { op: "set_conditional_formats", target: { sheet: "Data" }, attributes: { rules: [] } };
    const base = bridge.call.getMockImplementation()!;
    let refuse = true;
    bridge.call.mockImplementation(async (channel, payload) => {
      if (refuse && channel === "desktop:file-xlsx" && payload.operation === "edit") {
        refuse = false;
        throw new Error(`Error invoking remote method 'desktop:file-xlsx': XlsxTypedError: xlsx_rule_sets_dropped:[["cf",[1]]]`);
      }
      return base(channel, payload);
    });
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await session.open.open();
    await session.editor.edit?.([editOp, cfOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect(await session.coordinator.save("button")).toEqual({ accepted: false, reason: "error" });
    expect(session.coordinator.getState()).toMatchObject({ state: "error", error: { code: "xlsx_rule_sets_dropped", action: "retry", retryable: false } });
    expect(session.editor.droppedRuleSets?.()).toEqual([{ family: "conditionalFormats", sheet: "Data", savedRules: null }]);
    // Review m-2: the live draft stream loses the dropped op too.
    expect(((await session.editor.captureSnapshot()).value as { pendingOps?: unknown[] }).pendingOps).toEqual([editOp]);
    const edits = () => bridge.call.mock.calls.filter(([channel, payload]) => channel === "desktop:file-xlsx" && payload.operation === "edit").map(([, payload]) => payload.edits);
    expect(edits()).toEqual([[editOp, cfOp]]);
    expect(await session.coordinator.save("button")).toMatchObject({ accepted: true });
    expect(edits()).toEqual([[editOp, cfOp], [editOp]]);
    expect(session.editor.droppedRuleSets?.()).toEqual([]);
    expect(bridge.saved).toHaveLength(1);
  });
});

/** A local bridge whose desktop:file-save waits for the test (or forever). */
function heldSaveSession(behaviour: "hold" | "never" = "hold") {
  const bridge = makeLocalBridge();
  const base = bridge.call.getMockImplementation()!;
  let saveEntered = false;
  let releaseSave!: () => void;
  bridge.call.mockImplementation(async (channel: string, payload: Record<string, unknown>) => {
    if (channel !== "desktop:file-save") return base(channel, payload);
    saveEntered = true;
    await new Promise<void>((resolve) => { if (behaviour === "hold") releaseSave = resolve; });
    return base(channel, payload);
  });
  const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
  const editA1 = async (value: number) => { await session.editor.edit?.([{ ...editOp, attributes: { value } }]); session.coordinator.markDirty(session.editor.getDirtyGeneration()); };
  const rowsFor = (draftId: string) => bridge.call.mock.calls.filter(([channel, payload]) => channel === "desktop:draft-checkpoint" && (payload as { draftId: string }).draftId === draftId)
    .map(([, payload]) => (JSON.parse(Buffer.from((payload as { dataBase64: string }).dataBase64, "base64").toString("utf8")) as { value: { sheets: Array<{ cells: { A1: unknown } }> } }).value.sheets[0]?.cells.A1);
  return { bridge, session, editA1, rowsFor, saveEntered: () => saveEntered, releaseSave: () => releaseSave() };
}

/** coordinator.checkpoint reads a snapshot itself, then the gate captures:
 *  hold that second read (the gate's capture) until the test releases it. */
function holdGateCapture(session: ReturnType<typeof heldSaveSession>["session"]) {
  const capture = session.editor.captureSnapshot.bind(session.editor);
  let reads = 0;
  let held = false;
  let release!: () => void;
  const hold = new Promise<void>((resolve) => { release = resolve; });
  session.editor.captureSnapshot = async () => {
    reads += 1;
    const value = await capture();
    if (reads === 2) { held = true; await hold; }
    return value;
  };
  return { held: () => held, reads: () => reads, release: () => release() };
}

/** Resolves once the gate has parked on its bound (its timer is the only
 *  fake one). Polls on setImmediate, which stays real: vi.waitFor would move
 *  the fake clock by its interval on every check and eat into the bound.
 *  Date is faked too, so the deadline is counted on the same fake clock. */
async function gateParked() {
  while (vi.getTimerCount() !== 1) await new Promise((resolve) => setImmediate(resolve));
}

const oldDraftId = `${HANDLE}:${identity.baseVersionId}:100`;
const savedDraftId = `${HANDLE}:sha256:${"a".repeat(64)}:250`;

describe("desktop local xlsx session: draft checkpoints around a Save (T09)", () => {
  afterEach(() => { vi.useRealTimers(); });

  it("holds a checkpoint asked for mid-save until the Save settles, then writes it under the saved base", async () => {
    const { session, editA1, rowsFor, saveEntered, releaseSave } = heldSaveSession();
    await session.open.open();
    await editA1(7);
    const saving = session.coordinator.save("button");
    await vi.waitFor(() => expect(saveEntered()).toBe(true));
    await editA1(8);
    const gateCapture = holdGateCapture(session);
    const checkpointing = session.coordinator.checkpoint();
    await vi.waitFor(() => expect(gateCapture.reads()).toBe(1));
    await new Promise((resolve) => setTimeout(resolve, 20));
    // Parked behind the Save: the gate has not captured, nothing was written.
    expect(gateCapture.reads()).toBe(1);
    expect([...rowsFor(oldDraftId), ...rowsFor(savedDraftId)]).toEqual([]);
    releaseSave();
    await expect(saving).resolves.toMatchObject({ accepted: true });
    await vi.waitFor(() => expect(gateCapture.held()).toBe(true));
    gateCapture.release();
    await checkpointing;
    expect(rowsFor(savedDraftId)).toEqual([{ value: 8 }]);
    expect(rowsFor(oldDraftId)).toEqual([]);
  });

  it("releases a blocked Save at once and retries it as a fresh intent with a fresh candidate", async () => {
    const bridge = makeLocalBridge();
    const base = bridge.call.getMockImplementation()!;
    let refuse = true;
    bridge.call.mockImplementation(async (channel, payload) => {
      if (channel === "desktop:file-save" && refuse) { refuse = false; throw Object.assign(new Error("quota_exceeded"), { code: "quota_exceeded" }); }
      return base(channel, payload);
    });
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    await expect(session.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "blocked" });
    await expect(session.coordinator.retry()).resolves.toMatchObject({ accepted: true });
    expect(bridge.call.mock.calls.filter(([channel]) => channel === "desktop:file-save")).toHaveLength(2);
    // The released candidate is gone, so the Retry spends a fresh edit job.
    expect(bridge.call.mock.calls.filter(([channel, payload]) => channel === "desktop:file-xlsx" && payload.operation === "edit")).toHaveLength(2);
    expect(bridge.saved).toHaveLength(1);
  });

  it("writes nothing for a checkpoint parked behind a held Save once the session is disposed", async () => {
    const { session, editA1, rowsFor, saveEntered, releaseSave } = heldSaveSession();
    await session.open.open();
    await editA1(7);
    const saving = session.coordinator.save("button");
    await vi.waitFor(() => expect(saveEntered()).toBe(true));
    await editA1(8);
    const gateCapture = holdGateCapture(session);
    const checkpointing = session.coordinator.checkpoint();
    await vi.waitFor(() => expect(gateCapture.reads()).toBe(1));
    session.dispose();
    releaseSave();
    await saving.catch(() => undefined);
    // The parked capture resumes on a disposed editor and writes nothing.
    await expect(checkpointing).rejects.toThrow(/xlsx_(editor_disposed|snapshot_unavailable)/);
    expect([...rowsFor(oldDraftId), ...rowsFor(savedDraftId)]).toEqual([]);
  });

  it("keeps the draft under the pre-save base when the Save never answers", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { session, editA1, rowsFor, saveEntered } = heldSaveSession("never");
    await session.open.open();
    await editA1(7);
    void session.coordinator.save("button");
    await vi.waitFor(() => expect(saveEntered()).toBe(true));
    await editA1(8);
    const keeping = session.keepDraft();
    // Advance the fake clock only once the gate has parked on its bound. The
    // coordinator's own read digests through WebCrypto first, which settles on
    // a real thread, not on the fake clock: advancing before the park armed
    // the timer moved time past nothing, and the bound then never ran out.
    await gateParked();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(rowsFor(oldDraftId)).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await expect(keeping).resolves.toBe(true);
    expect(rowsFor(oldDraftId)).toEqual([{ value: 8 }]);
  });

  it("re-captures a timed-out capture that straddles the confirmed write", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const { session, editA1, rowsFor, saveEntered, releaseSave } = heldSaveSession();
    await session.open.open();
    await editA1(7);
    const saving = session.coordinator.save("button");
    await vi.waitFor(() => expect(saveEntered()).toBe(true));
    await editA1(8);
    const gateCapture = holdGateCapture(session);
    const checkpointing = session.coordinator.checkpoint();
    await vi.waitFor(() => expect(gateCapture.reads()).toBe(1));
    // Read 1 is still digesting on a real thread; wait until the gate parked
    // and armed its bound before moving the fake clock past it.
    await gateParked();
    // The bound runs out while the Save is still held: the gate captures edit 8.
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(gateCapture.held()).toBe(true));
    // The write is confirmed and the Save settles while that capture digests.
    releaseSave();
    await expect(saving).resolves.toMatchObject({ accepted: true });
    await editA1(9);
    gateCapture.release();
    await checkpointing;
    // The pre-save capture is never written under the saved base; the retake is.
    expect(rowsFor(savedDraftId)).toEqual([{ value: 9 }]);
    expect(rowsFor(oldDraftId)).toEqual([]);
  });
});

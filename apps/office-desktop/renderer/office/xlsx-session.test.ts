import { describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import { createDesktopXlsxSession } from "./xlsx-session";

const identity: OfficeIdentity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc-x", generation: 1, baseRevision: "2", baseVersionId: "1" };
const snapshot = { revision: 0, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 1 } } }] };
const renderModel = { revision: 1, activeTab: 0, date1904: false, styles: [], dxfStyles: [], sheets: [{ id: "sheet-1", name: "Data", rowCount: 2, columnCount: 2, cells: { A1: { v: 2 } }, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [] }] };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const editOp = { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } };

function makeBridge(openOutput: unknown = { snapshot, render_model: renderModel }) {
  return {
    call: vi.fn(async (channel: string, payload: Record<string, unknown>) => {
      if (channel === "desktop:office-job") {
        if (payload.operation === "open") return { jobId: "job-open", documentId: "doc-x", state: "completed", outputBase64: encode(openOutput) };
        return { jobId: "job-edit", documentId: "doc-x", state: "completed", outputBase64: Buffer.from([1, 2, 3]).toString("base64"), outputChecksum: `sha256:${"a".repeat(64)}` };
      }
      if (channel === "desktop:office-save") return { documentId: "doc-x", intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, versionId: "version-2", revision: "3", checksum: payload.checksum };
      if (channel === "desktop:draft-list") return { drafts: [] };
      if (channel === "desktop:draft-checkpoint") return { stored: true, generation: payload.generation };
      throw new Error("unexpected channel " + channel);
    }),
  };
}

describe("desktop xlsx session", () => {
  it("opens through the server open job and exposes the workbook snapshot", async () => {
    const bridge = makeBridge();
    const session = createDesktopXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "2", baseVersionId: "1" });
    const outcome = await session.open.open();
    expect(outcome).toMatchObject({ outcome: "opened", document_id: "doc-x" });
    expect(session.editor.getWorkbookSnapshot?.()?.sheets[0]?.name).toBe("Data");
    expect(bridge.call).toHaveBeenCalledWith("desktop:office-job", expect.objectContaining({ operation: "open", baseRevision: "2", format: "xlsx" }));
  });

  it("refuses a missing or malformed render model with the shared named error", async () => {
    for (const render_model of [undefined, { sheets: [] }, { ...renderModel, sheets: [{ id: "sheet-1" }] }]) {
      const bridge = makeBridge({ snapshot, render_model });
      const session = createDesktopXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "2", baseVersionId: "1" });
      await expect(session.open.open()).resolves.toMatchObject({ outcome: "failed", failure_class: "engine_error", message: "office_open_render_model_invalid" });
    }
  });

  it("applies grid edits locally and saves through the edit job then office-save", async () => {
    const bridge = makeBridge();
    const session = createDesktopXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "2", baseVersionId: "1" });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect(session.editor.getWorkbookSnapshot?.()?.sheets[0]?.cells.A1).toEqual({ value: 7 });

    const result = await session.coordinator.save("button");
    expect(result.accepted).toBe(true);
    const editCall = bridge.call.mock.calls.find(([channel, payload]) => channel === "desktop:office-job" && (payload as { operation: string }).operation === "edit");
    expect(editCall?.[1]).toMatchObject({ operation: "edit", baseRevision: "2", edits: [editOp] });
    expect(bridge.call).toHaveBeenCalledWith("desktop:office-save", expect.objectContaining({ format: "xlsx", baseRevision: "2", baseVersionId: "1", checksum: `sha256:${"a".repeat(64)}` }));
  });

  it("keeps and recovers a protected draft through the desktop draft IPC", async () => {
    const bridge = makeBridge();
    const session = createDesktopXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "2", baseVersionId: "1" });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect(await session.keepDraft()).toBe(true);
    expect(bridge.call).toHaveBeenCalledWith("desktop:draft-checkpoint", expect.objectContaining({ documentId: "doc-x" }));
  });

  it("re-captures a checkpoint whose capture resolved after the Save, so the row under the new base is post-save (T09 settle gate)", async () => {
    const bridge = makeBridge();
    const base = bridge.call.getMockImplementation()!;
    let saveEntered = false;
    let releaseSave!: () => void;
    bridge.call.mockImplementation(async (channel: string, payload: Record<string, unknown>) => {
      if (channel !== "desktop:office-save") return base(channel, payload);
      saveEntered = true;
      await new Promise<void>((resolve) => { releaseSave = resolve; });
      return base(channel, payload);
    });
    const session = createDesktopXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "2", baseVersionId: "1" });
    await session.open.open();
    const editA1 = async (value: number) => { await session.editor.edit?.([{ ...editOp, attributes: { value } }]); session.coordinator.markDirty(session.editor.getDirtyGeneration()); };
    await editA1(7);
    const saving = session.coordinator.save("button");
    await vi.waitFor(() => expect(saveEntered).toBe(true));
    await editA1(8);
    // The checkpoint's capture reads edit 8 now but resolves after the Save.
    const capture = session.editor.captureSnapshot.bind(session.editor);
    let held = false;
    let releaseCapture!: () => void;
    const hold = new Promise<void>((resolve) => { releaseCapture = resolve; });
    session.editor.captureSnapshot = async () => { const value = await capture(); session.editor.captureSnapshot = capture; held = true; await hold; return value; };
    const checkpointing = session.coordinator.checkpoint();
    await vi.waitFor(() => expect(held).toBe(true));
    releaseSave();
    await expect(saving).resolves.toMatchObject({ accepted: true });
    await editA1(9);
    releaseCapture();
    await checkpointing;
    const rows = bridge.call.mock.calls.filter(([channel, payload]) => channel === "desktop:draft-checkpoint" && (payload as { draftId: string }).draftId === "doc-x:version-2:3");
    expect(rows).toHaveLength(1);
    const stored = JSON.parse(Buffer.from((rows[0]![1] as { dataBase64: string }).dataBase64, "base64").toString("utf8")) as { value: { sheets: Array<{ cells: { A1: unknown } }> } };
    expect(stored.value.sheets[0]?.cells.A1).toEqual({ value: 9 });
  });

  it("releases a blocked Save at once and retries it as a fresh intent with a fresh candidate (T09)", async () => {
    const bridge = makeBridge();
    const base = bridge.call.getMockImplementation()!;
    let refuse = true;
    bridge.call.mockImplementation(async (channel, payload) => {
      if (channel === "desktop:office-save" && refuse) { refuse = false; throw Object.assign(new Error("quota_exceeded"), { code: "quota_exceeded" }); }
      return base(channel, payload);
    });
    const session = createDesktopXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "2", baseVersionId: "1" });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    await expect(session.coordinator.save("button")).resolves.toEqual({ accepted: false, reason: "blocked" });
    await expect(session.coordinator.retry()).resolves.toMatchObject({ accepted: true });
    const saves = bridge.call.mock.calls.filter(([channel]) => channel === "desktop:office-save").map(([, payload]) => payload);
    expect(saves).toHaveLength(2);
    expect(saves[1]?.idempotencyKey).not.toBe(saves[0]?.idempotencyKey);
    const edits = bridge.call.mock.calls.filter(([channel, payload]) => channel === "desktop:office-job" && payload.operation === "edit");
    expect(edits).toHaveLength(2);
  });
});

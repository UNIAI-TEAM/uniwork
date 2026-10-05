/** @vitest-environment jsdom */
import { describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import { createDesktopLocalXlsxSession } from "./xlsx-local-session";

const HANDLE = "file_" + "a".repeat(32);
const identity: OfficeIdentity = { deploymentId: "local-device", accountId: "local:device", organizationId: "local", workspaceId: "local", documentId: HANDLE, generation: 1, baseRevision: "100", baseVersionId: "sha256:" + "0".repeat(64) };
const snapshot = { revision: 0, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 1 } } }] };
const renderModel = { revision: 1, activeTab: 0, date1904: false, styles: [], dxfStyles: [], sheets: [{ id: "sheet-1", name: "Data", rowCount: 2, columnCount: 2, cells: { A1: { v: 2 } }, merges: [], columnWidths: [], rowsMeta: [], hyperlinks: [] }] };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const editOp = { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } };

/** A local-file bridge that mirrors main: the engine job rides
 *  desktop:file-xlsx, the Save writes the opaque handle through
 *  desktop:file-save, and no cloud channel is ever reached. */
function makeLocalBridge() {
  const saved: Uint8Array[] = [];
  const call = vi.fn(async (channel: string, payload: Record<string, unknown>) => {
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
  it("opens a local .xlsx through the main-owned engine job and exposes the workbook", async () => {
    const bridge = makeLocalBridge();
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    expect(await session.open.open()).toMatchObject({ outcome: "opened", document_id: HANDLE });
    expect(session.editor.getWorkbookSnapshot?.()?.sheets[0]?.name).toBe("Data");
    expect(bridge.call).toHaveBeenCalledWith("desktop:file-xlsx", expect.objectContaining({ handle: HANDLE, operation: "open" }));
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

  it("keeps a protected draft through the desktop draft IPC (local:<device>)", async () => {
    const bridge = makeLocalBridge();
    const session = createDesktopLocalXlsxSession({ bridge: bridge as never, identity, title: "Budget.xlsx", canSave: true, baseRevision: "100", baseVersionId: identity.baseVersionId, localHandle: HANDLE });
    await session.open.open();
    await session.editor.edit?.([editOp]);
    session.coordinator.markDirty(session.editor.getDirtyGeneration());
    expect(await session.keepDraft()).toBe(true);
    expect(bridge.call).toHaveBeenCalledWith("desktop:draft-checkpoint", expect.objectContaining({ documentId: HANDLE }));
  });
});

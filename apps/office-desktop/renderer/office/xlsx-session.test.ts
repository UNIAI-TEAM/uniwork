import { describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import { createDesktopXlsxSession } from "./xlsx-session";

const identity: OfficeIdentity = { deploymentId: "lane", accountId: "account", organizationId: "org", workspaceId: "ws", documentId: "doc-x", generation: 1, baseRevision: "2", baseVersionId: "1" };
const snapshot = { revision: 0, sheets: [{ id: "sheet-1", name: "Data", cells: { A1: { value: 1 } } }] };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64");
const editOp = { op: "set_cell", target: { sheet: "Data", cell: "A1" }, attributes: { value: 7 } };

function makeBridge() {
  return {
    call: vi.fn(async (channel: string, payload: Record<string, unknown>) => {
      if (channel === "desktop:office-job") {
        if (payload.operation === "open") return { jobId: "job-open", documentId: "doc-x", state: "completed", outputBase64: encode({ snapshot }) };
        return { jobId: "job-edit", documentId: "doc-x", state: "completed", outputBase64: Buffer.from([1, 2, 3]).toString("base64"), outputChecksum: `sha256:${"a".repeat(64)}` };
      }
      if (channel === "desktop:office-save") return { documentId: "doc-x", intentId: payload.intentId, idempotencyKey: payload.idempotencyKey, versionId: "version-2", revision: "3", checksum: payload.checksum };
      if (channel === "desktop:draft-list") return { drafts: [] };
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
    expect(bridge.call).toHaveBeenCalledWith("desktop:office-job", expect.objectContaining({ operation: "open", baseRevision: "2" }));
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
});

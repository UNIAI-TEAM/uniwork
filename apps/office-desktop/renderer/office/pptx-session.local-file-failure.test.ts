/** @vitest-environment node */
// UNI-954 P04 (review-fe-r2 F6): the local pptx session carries a refused
// desktop:file-* answer's code the same way the byte session does, on Save and on
// the context rebind that follows a confirmed Save. Real runtime and adapter
// (only the generated pptx artifact is the office-engine fake).
import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { OfficeIdentity } from "@uniwork/core/office";
import type { OpenedPptxLike, PptxEdit, PptxTxnRequest } from "@uniwork/office-engine/pptx";
import { makeFakePptxBytes } from "../../../../packages/office-engine/test/fake-pptx-fixtures";
import { createDesktopPptxAdapter } from "./pptx-adapter";
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

const handle = `file_${"p".repeat(40)}`;
const identity: OfficeIdentity = { deploymentId: "local", accountId: "local", organizationId: "local", workspaceId: "local", documentId: handle, generation: 1, baseRevision: "0", baseVersionId: "v0" };
const capability = { format: "pptx", operation: "edit", host: "desktop", engineBuild: "t", contractRevision: "office-editor-host/1", status: "available", fidelityWarnings: [] } as never;
const box = (xPx: number): PptxEdit => ({ op: "add_element", slideIndex: 0, kind: "rect", xPx, yPx: 1, wPx: 10, hPx: 10 });

/** A local pptx session whose file-save / file-open answers are scripted. */
async function openLocalSession(answer: (channel: string, payload: Record<string, unknown>) => unknown) {
  const bytes = makeFakePptxBytes();
  const calls: string[] = [];
  const bridge = { call: (async (channel: string, payload: Record<string, unknown>) => { calls.push(channel); return answer(channel, payload ?? {}); }) as LibraryBridge["call"] } as LibraryBridge;
  const checksum = `sha256:${"a".repeat(64)}`;
  const session = createPptxDocumentSession(bridge, identity, { format: "pptx", dataBase64: Buffer.from(bytes).toString("base64"), checksum, localHandle: handle }, (onDirty) =>
    createDesktopPptxAdapter({ identity, runtime: createWebPptxSessionRuntime({ documentId: handle }), readBytes: async () => bytes, capability, onDirty }));
  await session.openEditor();
  await session.editor.edit([box(1)]);
  return { session, calls };
}
const confirmed = (payload: Record<string, unknown>) => ({ opened: true, metadata: { handle, name: "Deck.pptx", byteLength: 5, modifiedAtMs: 10, checksum: String(payload.checksum) } });

describe("local pptx session refusal codes", () => {
  it("carries a refused Save's code to the save error, and a Retry on the same bytes writes once the cause clears", async () => {
    let locked = true;
    const { session, calls } = await openLocalSession((channel, payload) => {
      if (channel === "desktop:file-save") return locked ? { opened: false, code: "file_locked" } : { opened: true, metadata: { handle, name: "Deck.pptx", byteLength: 5, modifiedAtMs: 10, checksum: lastChecksum(payload) } };
      if (channel === "desktop:file-open") return { opened: true, metadata: { handle, name: "Deck.pptx", byteLength: 5, modifiedAtMs: 10, checksum: `sha256:${"a".repeat(64)}` } };
      return { drafts: [], stored: true, generation: 1, discarded: true };
    });
    await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: false, reason: "error" });
    expect(session.coordinator.getState()).toMatchObject({ state: "error", error: { code: "file_locked", action: "retry" } });
    expect(calls.filter((channel) => channel === "desktop:file-save").length).toBeGreaterThan(0);
    locked = false;
    await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
  }, 30_000);

  it("keeps a confirmed Save when the context rebind that follows is refused", async () => {
    const { session } = await openLocalSession((channel, payload) => {
      if (channel === "desktop:file-save") return confirmed({ checksum: lastChecksum(payload) });
      if (channel === "desktop:file-open") return { opened: false, code: "file_locked" };
      return { drafts: [], stored: true, generation: 1, discarded: true };
    });
    await expect(session.coordinator.save("button")).resolves.toMatchObject({ accepted: true });
    expect(session.coordinator.getState().error).toBeNull();
  });
});

/** The pptx save echoes the checksum of the bytes it sent, as main would. */
function lastChecksum(payload: Record<string, unknown>): string {
  const data = String(payload.dataBase64 ?? "");
  return `sha256:${createHash("sha256").update(Buffer.from(data, "base64")).digest("hex")}`;
}

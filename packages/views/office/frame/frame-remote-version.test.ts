import { describe, expect, it, vi } from "vitest";
import { DocsProtocolError, type SaveResult } from "@uniwork/core/office/docs-frame-protocol";
import { createFrameRemoteVersion, remoteAwareSave, type FrameBlock } from "./frame-remote-version";

const file = (revision: string, versionId: string) => ({ fileId: "doc-1", name: "Plan.docx", etag: revision, versionId });
const head = (revision: string, versionId: string | null) => ({ revision, versionId, savedAt: "2026-10-13T08:00:00Z" });

function remote(enabled = true) {
  const notify = vi.fn();
  const state = { enabled };
  const r = createFrameRemoteVersion({ documentId: "doc-1", enabled: () => state.enabled, notify });
  return { r, notify, state };
}

describe("createFrameRemoteVersion", () => {
  it("compares revisions as integers, also past Number precision", () => {
    const { r, notify } = remote();
    r.opened(file("9", "v1"));
    expect(r.offer(head("10", "v2"))).toBe(true);
    r.opened(file("9007199254740992", "v3"));
    // As Numbers both read 9007199254740992; as BigInt the second is newer.
    expect(r.offer(head("9007199254740993", "v4"))).toBe(true);
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("says nothing before the frame opened, for a page without a version, or with the flag off", () => {
    const { r, notify, state } = remote();
    expect(r.offer(head("10", "v2"))).toBe(false);
    r.opened(file("9", "v1"));
    expect(r.offer(head("10", null))).toBe(false);
    state.enabled = false;
    expect(r.offer(head("11", "v3"))).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });

  it("an older open answer landing late never moves the frame backwards", () => {
    const { r } = remote();
    r.opened(file("10", "v2"));
    r.opened(file("9", "v1"));
    expect(r.offer(head("10", "v2b"))).toBe(false);
  });

  it("decides a head read during an own Save once the Save settles", () => {
    const { r, notify } = remote();
    r.opened(file("9", "v1"));
    r.saveStarted();
    expect(r.offer(head("10", "own"))).toBe(false);
    r.committed(file("10", "own"), "own");
    r.saveEnded();
    expect(notify).not.toHaveBeenCalled();
    r.saveStarted();
    r.offer(head("12", "theirs"));
    r.saveEnded();
    expect(notify).toHaveBeenCalledWith({ document_id: "doc-1", revision: "12", version_id: "theirs", saved_at: "2026-10-13T08:00:00Z" });
  });

  it("rebind forgets the old document, its block included", () => {
    const { r, notify } = remote();
    r.opened(file("9", "v1"));
    r.block("document_deleted");
    r.rebind("doc-2");
    expect(r.blocked).toBeNull();
    r.opened({ ...file("1", "c1"), fileId: "doc-2" });
    r.offer(head("2", "c2"));
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ document_id: "doc-2", revision: "2" }));
  });
});

describe("remoteAwareSave", () => {
  const refuse = (status: number, apiCode?: string) =>
    new DocsProtocolError({ code: status === 403 ? "forbidden" : "internal", message: `HTTP ${status}`, status, ...(apiCode !== undefined ? { details: { apiCode } } : {}) });

  it.each<[string, DocsProtocolError, FrameBlock | null]>([
    ["410", refuse(410, "document_gone"), "document_deleted"],
    ["403 of another kind", refuse(403, "forbidden"), "permission_revoked"],
    ["403 organization_suspended", refuse(403, "organization_suspended"), null],
    ["403 member_deactivated", refuse(403, "member_deactivated"), null],
    ["403 document_archived", refuse(403, "document_archived"), null],
    ["a refusal made in the host (no apiCode)", refuse(403), null],
    ["409", new DocsProtocolError({ code: "conflict", message: "HTTP 409", status: 409, details: { apiCode: "document_version_conflict" } }), null],
  ])("a Save refused with %s blocks: %s", async (_why, error, expected) => {
    const { r } = remote();
    const onBlock = vi.fn();
    const save = remoteAwareSave(async () => { throw error; }, r, onBlock);
    await expect(save({}, {})).rejects.toBe(error);
    if (expected) expect(onBlock).toHaveBeenCalledWith(expected);
    else expect(onBlock).not.toHaveBeenCalled();
  });

  it("records an ok answer as this session's own version", async () => {
    const { r, notify } = remote();
    r.opened(file("9", "v1"));
    const save = remoteAwareSave(async (): Promise<SaveResult> => ({ ok: true, file: file("10", "own"), versionId: "own" }), r, vi.fn());
    await save({}, {});
    expect(r.offer(head("10", "own"))).toBe(false);
    expect(notify).not.toHaveBeenCalled();
  });
});

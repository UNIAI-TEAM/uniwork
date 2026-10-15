import { describe, expect, it } from "vitest";
import type { Document, DocumentComment } from "@uniwork/core/types/document";
import { K } from "./document-comments-keys";
import {
  anchorLabel,
  anchorStateKey,
  anchorableFormat,
  canCommentInPanel,
  canResolveCommentThread,
  formatMentionList,
  resolveNoAccessMentionsForSend,
  findDeepLinkTarget,
  formatCollabTime,
  listSignature,
  replyTargetOf,
  threadsOf,
} from "./document-comments-model";

const file = (filename: string, mime = "application/octet-stream"): Pick<Document, "kind" | "file"> => ({
  kind: "file",
  file: { file_id: "f", version_id: "v", version: 1, filename, mime_type: mime, size_bytes: 1, checksum_sha256: "a" },
});

function c(over: Partial<DocumentComment>): DocumentComment {
  return {
    id: "x",
    document_id: "d1",
    author_id: "u1",
    author_kind: "human",
    body: "b",
    parent_id: null,
    type: "comment",
    kind: "comment",
    anchor: null,
    anchor_state: null,
    revision: 1,
    resolved_at: null,
    created_at: "2026-10-13T01:00:00Z",
    updated_at: "2026-10-13T01:00:00Z",
    display_name: "An",
    avatar_url: "",
    reactions: [],
    ...over,
  } as DocumentComment;
}

describe("anchorableFormat (which documents get the Comments tab)", () => {
  it("is docx, xlsx, pptx and pdf only", () => {
    expect(anchorableFormat(file("a.docx"))).toBe("docx");
    expect(anchorableFormat(file("a.bin", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))).toBe("xlsx");
    expect(anchorableFormat(file("a.PPTX"))).toBe("pptx");
    expect(anchorableFormat(file("a", "application/pdf"))).toBe("pdf");
    expect(anchorableFormat(file("a.md", "text/markdown"))).toBeNull();
    expect(anchorableFormat(file("a.html", "text/html"))).toBeNull();
    expect(anchorableFormat({ kind: "page", file: null })).toBeNull();
  });
});

describe("anchorLabel (one key with a placeholder per format)", () => {
  it("cuts a docx quote at 60 characters and keeps the full quote for the tooltip", () => {
    const quote = "a".repeat(70);
    expect(anchorLabel({ format: "docx", v: 1, quote }, "vi")).toEqual({
      key: K.collabAnchorDocx,
      values: { quote: `${"a".repeat(60)}…` },
      title: quote,
    });
    expect(anchorLabel({ format: "docx", v: 1, quote: "doanh thu" }, "vi")?.values.quote).toBe("doanh thu");
  });

  it("names the cell, the 1-based slide and the page in the reader's locale", () => {
    expect(anchorLabel({ format: "xlsx", v: 1, sheet: "Doanh thu", range: "B7:D9" }, "en")).toEqual({ key: K.collabAnchorCell, values: { cell: "'Doanh thu'!B7:D9" } });
    expect(anchorLabel({ format: "pptx", v: 1, slide_id: "257", slide_index: 4 }, "en")).toEqual({ key: K.collabAnchorSlide, values: { slide: "5" } });
    expect(anchorLabel({ format: "pdf", v: 1, page: 1200, rect: [0, 0, 1, 1] }, "en")).toEqual({ key: K.collabAnchorPage, values: { page: "1,200" } });
  });

  it("qualifies an xlsx cell with a readable sheet name and falls back to the range alone otherwise", () => {
    const cell = (sheet: unknown) => anchorLabel({ format: "xlsx", v: 1, sheet, range: "B7" }, "en")?.values.cell;
    expect(cell("Sheet1")).toBe("'Sheet1'!B7");
    expect(cell("Tom's sheet")).toBe("'Tom''s sheet'!B7");
    // The sheet is the workbook's stable id when it has one: an id reads as no name.
    expect(cell("01J8X4USR0000000000000000A")).toBe("B7");
    expect(cell("0f8fad5b-d9cb-469f-a165-70867728950e")).toBe("B7");
    expect(cell("1024")).toBe("B7");
    expect(cell("")).toBe("B7");
    expect(cell(undefined)).toBe("B7");
    expect(cell("x".repeat(40))).toBe("B7");
  });

  it("reads an anchor it does not understand as no anchor", () => {
    expect(anchorLabel(null, "vi")).toBeNull();
    expect(anchorLabel({ format: "odt" }, "vi")).toBeNull();
    expect(anchorLabel({ format: "pptx", slide_index: -1 }, "vi")).toBeNull();
    expect(anchorLabel({ format: "pdf", page: 0 }, "vi")).toBeNull();
  });

  it("says stale and lost in words, and nothing for exact", () => {
    expect(anchorStateKey("stale")).toBe(K.collabAnchorStale);
    expect(anchorStateKey("lost")).toBe(K.collabAnchorLost);
    expect(anchorStateKey("exact")).toBeNull();
    expect(anchorStateKey(null)).toBeNull();
  });
});

describe("threadsOf (S12/S13 order and groups)", () => {
  it("orders comments by place in the document, lost ones last by creation time", () => {
    const rows = [
      c({ id: "p3", anchor: { format: "pdf", page: 3, rect: [0, 0, 1, 1] } }),
      c({ id: "lost", anchor: { format: "pdf", page: 1, rect: [0, 0, 1, 1] }, anchor_state: "lost", created_at: "2026-10-13T00:00:00Z" }),
      c({ id: "p1low", anchor: { format: "pdf", page: 1, rect: [0, 100, 10, 110] } }),
      c({ id: "p1top", anchor: { format: "pdf", page: 1, rect: [0, 700, 10, 710] } }),
      c({ id: "disc", kind: "discussion" }),
    ];
    expect(threadsOf(rows, "comment").open.map((t) => t.root.id)).toEqual(["p1top", "p1low", "p3", "lost"]);
    expect(threadsOf(rows, "discussion").open.map((t) => t.root.id)).toEqual(["disc"]);
  });

  it("orders docx by block path then offset and xlsx by sheet, row, column", () => {
    const docx = [
      c({ id: "b", anchor: { format: "docx", path: [3, 0], start: 2, quote: "q" } }),
      c({ id: "a", anchor: { format: "docx", path: [1], start: 9, quote: "q" } }),
      c({ id: "c", anchor: { format: "docx", path: [3, 0], start: 10, quote: "q" } }),
    ];
    expect(threadsOf(docx, "comment").open.map((t) => t.root.id)).toEqual(["a", "b", "c"]);
    const xlsx = [
      c({ id: "c10", anchor: { format: "xlsx", sheet: "S1", range: "C10" } }),
      c({ id: "aa2", anchor: { format: "xlsx", sheet: "S1", range: "AA2" } }),
      c({ id: "b2", anchor: { format: "xlsx", sheet: "S1", range: "B2" } }),
    ];
    expect(threadsOf(xlsx, "comment").open.map((t) => t.root.id)).toEqual(["b2", "aa2", "c10"]);
  });

  it("puts a resolved thread in the resolved group and keeps replies under their root", () => {
    const rows = [
      c({ id: "r", kind: "discussion", resolved_at: "2026-10-13T02:00:00Z" }),
      c({ id: "r1", kind: "discussion", parent_id: "r" }),
      c({ id: "o", kind: "discussion" }),
    ];
    const groups = threadsOf(rows, "discussion");
    expect(groups.open.map((t) => t.root.id)).toEqual(["o"]);
    expect(groups.resolved.map((t) => [t.root.id, t.replies.map((r) => r.id)])).toEqual([["r", ["r1"]]]);
  });

  it("reads a pre-G8 row that only says type discussion as a Discussion post", () => {
    expect(threadsOf([c({ id: "old", type: "discussion", kind: "discussion" })], "discussion").open).toHaveLength(1);
  });
});

describe("replyTargetOf, findDeepLinkTarget, listSignature, formatCollabTime", () => {
  it("takes no reply on a thread whose root was deleted", () => {
    const live = { root: c({ id: "a" }), replies: [] };
    const gone = { root: c({ id: "a", deleted_at: "2026-10-13T03:00:00Z", body: "" }), replies: [c({ id: "b", parent_id: "a" })] };
    expect(replyTargetOf(live)?.id).toBe("a");
    expect(replyTargetOf(gone)).toBeNull();
  });

  it("finds the thread, kind and state a deep link names", () => {
    const rows = [
      c({ id: "root", kind: "discussion", resolved_at: "2026-10-13T02:00:00Z" }),
      c({ id: "reply", kind: "discussion", parent_id: "root", deleted_at: "2026-10-13T03:00:00Z" }),
    ];
    expect(findDeepLinkTarget(rows, "reply")).toEqual({ rootId: "root", kind: "discussion", deleted: true, resolved: true });
    expect(findDeepLinkTarget(rows, "missing")).toBeNull();
  });

  it("changes the signature only when what the list shows changes", () => {
    const a = [c({ id: "a" })];
    expect(listSignature(a)).toBe(listSignature([c({ id: "a" })]));
    expect(listSignature(a)).not.toBe(listSignature([c({ id: "a", revision: 2 })]));
    expect(listSignature(a)).not.toBe(listSignature([c({ id: "a", resolved_at: "2026-10-13T02:00:00Z" })]));
  });

  it("formats {time}: clock today, day and month this year, the year before that", () => {
    const now = new Date(2026, 9, 13, 18, 0);
    expect(formatCollabTime(new Date(2026, 9, 13, 15, 30).toISOString(), "vi", now)).toBe("15:30");
    expect(formatCollabTime(new Date(2026, 9, 12, 15, 30).toISOString(), "vi", now)).toBe("12/10 15:30");
    expect(formatCollabTime(new Date(2026, 9, 12, 15, 30).toISOString(), "en", now)).toBe("Oct 12, 3:30 PM");
    expect(formatCollabTime(new Date(2025, 9, 12, 15, 30).toISOString(), "vi", now)).toBe("12/10/2025 15:30");
    expect(formatCollabTime("nope", "vi", now)).toBe("");
  });
});

describe("G8-18 / DOC-05 model rules", () => {
  const root = (over: Record<string, unknown> = {}) => ({ author_id: "u1", author_kind: "human", deleted_at: null, ...over }) as Parameters<typeof canResolveCommentThread>[0]["root"];
  const base = { canWrite: true, currentUserId: "u1" };

  it("canCommentInPanel: comment, edit and manage write; view, none and an unknown level do not; a refusal wins", () => {
    for (const level of ["comment", "edit", "manage"]) expect(canCommentInPanel({ my_level: level as never })).toBe(true);
    for (const level of ["view", "", "owner"]) expect(canCommentInPanel({ my_level: level as never })).toBe(false);
    expect(canCommentInPanel({ my_level: "manage" }, true)).toBe(false);
    expect(canCommentInPanel(null)).toBe(false);
  });

  it("canResolveCommentThread: edit+ any thread; comment only the root author; reply authors and agents never", () => {
    expect(canResolveCommentThread({ ...base, level: "edit", root: root({ author_id: "other" }) })).toBe(true);
    expect(canResolveCommentThread({ ...base, level: "manage", root: root({ author_id: "other" }) })).toBe(true);
    expect(canResolveCommentThread({ ...base, level: "comment", root: root() })).toBe(true);
    expect(canResolveCommentThread({ ...base, level: "comment", root: root({ author_id: "other" }) })).toBe(false);
    expect(canResolveCommentThread({ ...base, level: "comment", root: root({ author_kind: "agent" }) })).toBe(false);
    expect(canResolveCommentThread({ ...base, level: "view", root: root() })).toBe(false);
    expect(canResolveCommentThread({ ...base, level: "weird", root: root() })).toBe(false);
    expect(canResolveCommentThread({ ...base, canWrite: false, level: "manage", root: root() })).toBe(false);
    expect(canResolveCommentThread({ ...base, level: "manage", root: root({ deleted_at: "2026-10-13T00:00:00Z" }) })).toBe(false);
  });

  it("formatMentionList lists every name, locale-aware", () => {
    expect(formatMentionList(["An"], "en")).toBe("An");
    expect(formatMentionList(["An", "Bình"], "en")).toBe("An and Bình");
    expect(formatMentionList(["An", "Bình", "Cường"], "en")).toBe("An, Bình, and Cường");
    expect(formatMentionList(["An", "Bình", "Cường"], "vi")).toBe("An, Bình và Cường");
    expect(formatMentionList([" ", ""], "en")).toBe("");
  });

  it("resolveNoAccessMentionsForSend warns only for picked can_view=false tokens still in the body and not yet shared", () => {
    const U1 = "01J8X4USR0000000000000000A";
    const U2 = "01J8X4USR0000000000000000B";
    const body = `a [@An](mention://member/${U1}) b [@Bình](mention://member/${U2})`;
    const picked = new Map([[U1, { user_id: U1, display_name: "An", can_view: false }]]);
    const run = (over: object = {}) => resolveNoAccessMentionsForSend({ body, pickedCandidates: picked, sharedUserIds: new Set(), canShare: true, ...over });
    expect(run()).toEqual([{ user_id: U1, display_name: "An", can_share: true }]);
    expect(run({ sharedUserIds: new Set([U1]) })).toEqual([]);
    expect(run({ canShare: false })[0]!.can_share).toBe(false);
    // Nothing known about the document or the caller: cannot share (never upward).
    expect(run({ canShare: undefined, doc: undefined })[0]!.can_share).toBe(false);
    expect(run({ canShare: undefined, doc: null })[0]!.can_share).toBe(false);
    expect(run({ body: "no mention" })).toEqual([]);
    // Admin-scope callers cannot share with themselves (spec §3 can_share rule 4).
    expect(run({ canShare: undefined, doc: { my_level: undefined, owner_kind: undefined, admin_scope: true }, currentUserId: U1 })[0]!.can_share).toBe(false);
    // Work Product documents never share.
    expect(run({ canShare: undefined, doc: { my_level: "manage", owner_kind: "task", admin_scope: undefined } })[0]!.can_share).toBe(false);
  });
});

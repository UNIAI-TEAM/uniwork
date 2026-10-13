import { describe, expect, it } from "vitest";
import type { Document, DocumentComment } from "@uniwork/core/types/document";
import { K } from "./document-comments-keys";
import {
  anchorLabel,
  anchorStateKey,
  anchorableFormat,
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
    expect(anchorLabel({ format: "xlsx", v: 1, sheet: "S1", range: "B7:D9" }, "en")).toEqual({ key: K.collabAnchorCell, values: { cell: "B7:D9" } });
    expect(anchorLabel({ format: "pptx", v: 1, slide_id: "257", slide_index: 4 }, "en")).toEqual({ key: K.collabAnchorSlide, values: { slide: "5" } });
    expect(anchorLabel({ format: "pdf", v: 1, page: 1200, rect: [0, 0, 1, 1] }, "en")).toEqual({ key: K.collabAnchorPage, values: { page: "1,200" } });
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

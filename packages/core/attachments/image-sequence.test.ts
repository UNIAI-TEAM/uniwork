import { describe, expect, it } from "vitest";
import type { Attachment } from "../types/attachment";
import { attachmentDownloadPath } from "../types/attachment-url";
import {
  collectImageSequence,
  indexOfImageKey,
  isImageAttachment,
  matchAttachmentByURL,
  selectStandaloneAttachments,
} from "./image-sequence";

const att = (partial: Partial<Attachment> & Pick<Attachment, "id" | "filename">): Attachment => ({
  workspace_id: "ws1",
  task_id: "t1",
  url: `https://cdn.example/${partial.id}`,
  download_url: attachmentDownloadPath(partial.id),
  markdown_url: "",
  content_type: "image/png",
  size_bytes: 10,
  created_at: "2026-09-09T10:00:00Z",
  ...partial,
});

describe("image-sequence", () => {
  it("classifies images by content-type and extension fallback", () => {
    expect(isImageAttachment("image/png; charset=utf-8", "x.bin")).toBe(true);
    expect(isImageAttachment("application/octet-stream", "shot.JPEG")).toBe(true);
    expect(isImageAttachment("text/plain", "readme.txt")).toBe(false);
    expect(isImageAttachment("", ".hidden")).toBe(false);
  });

  it("matches attachments by stable download id or legacy URLs", () => {
    const a = att({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", filename: "a.png" });
    expect(matchAttachmentByURL("", [a])).toBeUndefined();
    expect(matchAttachmentByURL(a.download_url, [a])?.id).toBe(a.id);
    expect(matchAttachmentByURL(`${a.url}?sig=1`, [a])?.id).toBe(a.id);
    expect(matchAttachmentByURL("https://other/x.png", [a])).toBeUndefined();
  });

  it("keeps standalone cards only when not already referenced inline", () => {
    const a = att({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", filename: "a.png" });
    const b = att({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAW",
      filename: "a.png",
      content_type: "image/png",
      size_bytes: 10,
    });
    expect(selectStandaloneAttachments(null, [a])).toEqual([a]);
    expect(selectStandaloneAttachments(`![x](${a.download_url})`, [a, b])).toEqual([]);
    expect(selectStandaloneAttachments("plain", null)).toEqual([]);
  });

  it("collects inline + standalone images and indexes keys", () => {
    const a = att({ id: "01ARZ3NDEKTSV4RRFFQ69G5FAV", filename: "a.png" });
    const pdf = att({
      id: "01ARZ3NDEKTSV4RRFFQ69G5FAX",
      filename: "doc.pdf",
      content_type: "application/pdf",
    });
    const content = [
      "```md",
      "![ignored](https://example.com/in-fence.png)",
      "```",
      `![shot](${a.download_url})`,
      '<img src="https://example.com/raw.png" />',
      "!file[notes.pdf](https://example.com/notes.pdf)",
      "!file[photo.jpg](https://example.com/photo.jpg)",
    ].join("\n");

    const seq = collectImageSequence([
      null,
      { content, attachments: [a, pdf] },
      { content: "", attachments: [pdf] },
    ]);
    expect(seq.map((i) => i.key)).toEqual([
      a.id,
      "https://example.com/raw.png",
      "https://example.com/photo.jpg",
    ]);
    expect(indexOfImageKey(seq, a.id)).toBe(0);
    expect(indexOfImageKey(seq, "")).toBe(-1);
    expect(indexOfImageKey(seq, "missing")).toBe(-1);
  });
});

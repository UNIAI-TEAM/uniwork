import { describe, expect, it } from "vitest";
import type { Attachment } from "../types/attachment";
import {
  collectImageSequence,
  indexOfImageKey,
  isImageAttachment,
  matchAttachmentByURL,
  selectStandaloneAttachments,
} from "./image-sequence";

function attachment(partial: Partial<Attachment> & Pick<Attachment, "id" | "filename">): Attachment {
  return {
    workspace_id: "ws1",
    url: partial.url ?? `https://cdn.example/${partial.id}`,
    download_url:
      partial.download_url ??
      `https://api.example/api/v1/attachments/${partial.id}/download`,
    markdown_url: partial.markdown_url ?? "",
    content_type: partial.content_type ?? "image/png",
    size_bytes: partial.size_bytes ?? 100,
    created_at: "2026-01-01T00:00:00Z",
    ...partial,
  };
}

describe("isImageAttachment", () => {
  it("treats image/* content-type as image regardless of filename", () => {
    expect(isImageAttachment("image/webp", "notes.txt")).toBe(true);
  });

  it("falls back to extension when content-type is not image/*", () => {
    expect(isImageAttachment("application/octet-stream", "chart.png")).toBe(true);
    expect(isImageAttachment("application/pdf", "report.pdf")).toBe(false);
  });

  it("strips content-type parameters", () => {
    expect(isImageAttachment("image/png; charset=utf-8", "x")).toBe(true);
  });
});

describe("matchAttachmentByURL", () => {
  const a = attachment({
    id: "01ATTACH000000000000000001",
    filename: "a.png",
    download_url:
      "https://api.example/api/v1/attachments/01ATTACH000000000000000001/download?sig=1",
  });

  it("returns undefined for empty inputs", () => {
    expect(matchAttachmentByURL("", [a])).toBeUndefined();
    expect(matchAttachmentByURL(a.download_url, null)).toBeUndefined();
    expect(matchAttachmentByURL(a.download_url, [])).toBeUndefined();
  });

  it("matches by attachment id in the download URL", () => {
    expect(
      matchAttachmentByURL(
        "https://other.host/api/v1/attachments/01ATTACH000000000000000001/download",
        [a],
      ),
    ).toBe(a);
  });

  it("matches legacy full URLs ignoring query strings", () => {
    const legacy = attachment({
      id: "legacy1",
      filename: "b.png",
      url: "https://cdn.example/b.png?token=old",
      download_url: "https://cdn.example/b.png?token=old",
    });
    expect(matchAttachmentByURL("https://cdn.example/b.png?token=new", [legacy])).toBe(legacy);
  });
});

describe("selectStandaloneAttachments", () => {
  const inline = attachment({
    id: "01ATTACH000000000000000002",
    filename: "inline.png",
    download_url: "https://api.example/api/v1/attachments/01ATTACH000000000000000002/download",
  });
  const card = attachment({
    id: "01ATTACH000000000000000003",
    filename: "card.png",
    download_url: "https://api.example/api/v1/attachments/01ATTACH000000000000000003/download",
  });

  it("returns all attachments when content is empty", () => {
    expect(selectStandaloneAttachments("", [inline, card])).toEqual([inline, card]);
    expect(selectStandaloneAttachments(null, [card])).toEqual([card]);
  });

  it("drops attachments already referenced in the body", () => {
    const content = `![x](${inline.download_url})`;
    expect(selectStandaloneAttachments(content, [inline, card])).toEqual([card]);
  });

  it("drops a duplicate row when a sibling is already inline", () => {
    const dup = attachment({
      id: "dup",
      filename: inline.filename,
      content_type: inline.content_type,
      size_bytes: inline.size_bytes,
      download_url: "https://cdn.example/dup.png",
    });
    const content = `![x](${inline.download_url})`;
    expect(selectStandaloneAttachments(content, [inline, dup])).toEqual([]);
  });
});

describe("collectImageSequence", () => {
  it("collects markdown images, html img, and standalone image cards", () => {
    const inline = attachment({
      id: "01ATTACH000000000000000010",
      filename: "inline.png",
      download_url: "https://api.example/api/v1/attachments/01ATTACH000000000000000010/download",
    });
    const card = attachment({
      id: "01ATTACH000000000000000011",
      filename: "card.jpg",
      content_type: "image/jpeg",
      download_url: "https://api.example/api/v1/attachments/01ATTACH000000000000000011/download",
    });
    const pdf = attachment({
      id: "01ATTACH000000000000000012",
      filename: "doc.pdf",
      content_type: "application/pdf",
      download_url: "https://api.example/api/v1/attachments/01ATTACH000000000000000012/download",
    });

    const items = collectImageSequence([
      null,
      {
        content: [
          `![alt](${inline.download_url})`,
          `<img src="https://cdn.example/external.png">`,
          "```",
          "![ignored](https://cdn.example/in-fence.png)",
          "```",
          "!file[shot.png](https://cdn.example/shot.png)",
          "!file[notes.pdf](https://cdn.example/notes.pdf)",
        ].join("\n"),
        attachments: [inline, card, pdf],
      },
    ]);

    expect(items.map((i) => i.key)).toEqual([
      inline.id,
      "https://cdn.example/external.png",
      "https://cdn.example/shot.png",
      card.id,
    ]);
    expect(items.some((i) => i.key === pdf.id)).toBe(false);
    expect(items.some((i) => i.url.includes("in-fence"))).toBe(false);
  });

  it("dedupes by key and skips empty blocks", () => {
    const items = collectImageSequence([
      { content: "![a](https://cdn.example/a.png)" },
      { content: "![again](https://cdn.example/a.png)" },
      undefined,
    ]);
    expect(items).toHaveLength(1);
    expect(indexOfImageKey(items, "https://cdn.example/a.png")).toBe(0);
    expect(indexOfImageKey(items, "")).toBe(-1);
    expect(indexOfImageKey(items, "missing")).toBe(-1);
  });
});

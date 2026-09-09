import { describe, expect, it } from "vitest";
import {
  attachmentDownloadPath,
  attachmentIdFromDownloadURL,
  contentReferencesAttachment,
  stripChannelMediaMarkers,
} from "./attachment-url";

describe("attachment-url helpers", () => {
  it("builds and parses stable download paths including host/query forms", () => {
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    expect(attachmentDownloadPath(id)).toBe(`/api/v1/attachments/${id}/download`);
    expect(attachmentIdFromDownloadURL(attachmentDownloadPath(id))).toBe(id);
    expect(
      attachmentIdFromDownloadURL(
        `https://app.example/api/v1/attachments/${id}/download?exp=1#frag`,
      ),
    ).toBe(id);
    expect(attachmentIdFromDownloadURL("")).toBeUndefined();
    expect(attachmentIdFromDownloadURL("/api/v1/attachments/not-an-id/download")).toBeUndefined();
    expect(attachmentIdFromDownloadURL("/api/v1/attachments/x/content")).toBeUndefined();
    expect(attachmentIdFromDownloadURL("https://[::1")).toBeUndefined();
  });

  it("strips channel-media markers and detects body references", () => {
    const id = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    const stable = attachmentDownloadPath(id);
    const marked = `before <!-- uniwork:channel-media:aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee --> after ![x](${stable})`;
    expect(stripChannelMediaMarkers(marked)).toBe(`before  after ![x](${stable})`);

    const att = {
      id,
      url: "https://cdn.example/u.png?exp=1",
      download_url: "https://cdn.example/d.png?exp=2",
      markdown_url: "https://cdn.example/m.png?exp=3",
    };
    expect(contentReferencesAttachment("", att)).toBe(false);
    expect(contentReferencesAttachment(`see ${stable}`, att)).toBe(true);
    expect(contentReferencesAttachment("https://cdn.example/u.png?exp=1", att)).toBe(true);
    expect(contentReferencesAttachment("https://cdn.example/d.png", att)).toBe(true);
    expect(contentReferencesAttachment("https://cdn.example/m.png", att)).toBe(true);
    expect(contentReferencesAttachment("unrelated", att)).toBe(false);
  });
});

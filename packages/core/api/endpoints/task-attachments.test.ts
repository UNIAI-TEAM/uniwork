import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureRuntime, resetRuntimeConfig } from "../../runtime-config";
import { setAccessToken } from "../session";
import {
  attachmentContentPath,
  attachmentDownloadPath,
  deleteAttachment,
  getAttachment,
  listTaskAttachments,
  uploadTaskAttachment,
} from "./task-attachments";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const attachment = {
  id: "a1",
  workspace_id: "ws1",
  task_id: "t1",
  filename: "note.md",
  url: "/api/v1/attachments/a1/content",
  download_url: "/api/v1/attachments/a1/download",
  content_type: "text/markdown",
  size_bytes: 12,
  created_at: "2026-09-09T10:00:00Z",
};

describe("task-attachments endpoints", () => {
  beforeEach(() => {
    setAccessToken("tok");
    vi.stubGlobal("fetch", vi.fn());
    configureRuntime({ apiUrl: "http://api.test" });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    resetRuntimeConfig();
    setAccessToken(null);
  });

  it("listTaskAttachments / getAttachment degrade on malformed", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json({ attachments: [attachment] }))
      .mockResolvedValueOnce(json({ attachments: [{ id: 1 }] }))
      .mockResolvedValueOnce(json(attachment))
      .mockResolvedValueOnce(json({ nope: true }));
    expect((await listTaskAttachments("t1"))[0]?.id).toBe("a1");
    await expect(listTaskAttachments("t1")).resolves.toEqual([]);
    expect((await getAttachment("a1"))?.id).toBe("a1");
    await expect(getAttachment("a1")).resolves.toBeNull();
  });

  it("uploadTaskAttachment sends multipart file and degrades on drift", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(json(attachment))
      .mockResolvedValueOnce(json({ id: 1 }));
    const file = new File(["# hi"], "note.md", { type: "text/markdown" });
    expect((await uploadTaskAttachment("t1", file))?.filename).toBe("note.md");
    const init = vi.mocked(fetch).mock.calls[0]![1]!;
    expect(init.body).toBeInstanceOf(FormData);
    const form = init.body as FormData;
    expect(form.get("file")).toBeTruthy();
    await expect(uploadTaskAttachment("t1", file)).resolves.toBeNull();
  });

  it("deleteAttachment tolerates 204", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(null, { status: 204 }));
    await expect(deleteAttachment("a1")).resolves.toBeUndefined();
  });

  it("path builders are stable attachment routes", () => {
    expect(attachmentContentPath("a1")).toBe("/api/v1/attachments/a1/content");
    expect(attachmentDownloadPath("a1")).toBe("/api/v1/attachments/a1/download");
  });
});

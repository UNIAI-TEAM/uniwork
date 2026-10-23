import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/http";
import { deleteAskAttachment, uploadAskAttachment } from "../api/endpoints/ai-attachments";
import type { AskUploadedFile } from "../types/ai";
import {
  askDisplayAttachments,
  ASK_FILES_MAX,
  ASK_FILES_TOTAL_MAX_BYTES,
  ASK_FILE_ACCEPT,
  ASK_FILE_MAX_BYTES,
  useAskAttachments,
} from "./use-ask-attachments";

vi.mock("../api/endpoints/ai-attachments", () => ({
  uploadAskAttachment: vi.fn(),
  deleteAskAttachment: vi.fn(),
}));

type Upload = {
  file: File;
  signal: AbortSignal;
  onProgress: (loaded: number, total: number) => void;
  resolve: (r: Partial<AskUploadedFile>) => void;
  reject: (e: unknown) => void;
};
let uploads: Upload[];

beforeEach(() => {
  uploads = [];
  vi.mocked(uploadAskAttachment).mockImplementation(
    (_ws, file, opts) =>
      new Promise<AskUploadedFile>((resolve, reject) => {
        uploads.push({
          file,
          signal: opts!.signal!,
          onProgress: opts!.onProgress!,
          resolve: (r) =>
            resolve({ file_id: `id-${file.name}`, name: file.name, mime: file.type, size: file.size, kind: "pdf", ...r }),
          reject,
        });
      }),
  );
  vi.mocked(deleteAskAttachment).mockResolvedValue(undefined);
});
afterEach(() => vi.clearAllMocks());

/** A file of `size` bytes without allocating them. */
function f(name: string, size = 10, type = "application/pdf"): File {
  const file = new File(["x"], name, { type });
  Object.defineProperty(file, "size", { value: size });
  return file;
}
const MB = 1024 * 1024;
const setup = (ws = "ws1") => renderHook((p: { ws: string }) => useAskAttachments(p.ws), { initialProps: { ws } });
const keyOf = (r: { current: ReturnType<typeof useAskAttachments> }, name: string) =>
  r.current.files.find((x) => x.file.name === name)!.key;

describe("useAskAttachments", () => {
  it("exposes the limits and an accept list with extensions and MIME types, without .doc", () => {
    expect([ASK_FILE_MAX_BYTES, ASK_FILES_TOTAL_MAX_BYTES, ASK_FILES_MAX]).toEqual([20 * MB, 20 * MB, 5]);
    const accept = ASK_FILE_ACCEPT.split(",");
    expect(accept).toEqual(expect.arrayContaining([".pdf", ".docx", ".md", "image/png", "text/csv", "application/pdf"]));
    expect(accept).not.toContain(".doc");
    expect(accept).not.toContain(".xls");
  });

  it("refuses a 21 MB file, a sixth file, 20 MB + 1 in total and a .doc, without uploading them", () => {
    const { result } = setup();
    let reasons: string[] = [];
    act(() => {
      reasons = result.current.add([f("big.pdf", 21 * MB), f("old.doc", 10, "application/msword")]);
    });
    expect(reasons).toEqual(["too_large", "type_unsupported"]);
    expect(result.current.files).toEqual([]);
    expect(uploadAskAttachment).not.toHaveBeenCalled();

    // One call: the first fits, the second is the byte that tips the total over.
    act(() => {
      reasons = result.current.add([f("a.pdf", 10 * MB), f("b.pdf", 10 * MB + 1)]);
    });
    expect(reasons).toEqual(["total_too_large"]);
    expect(result.current.files.map((x) => x.file.name)).toEqual(["a.pdf"]);

    act(() => {
      reasons = result.current.add([f("c.pdf"), f("d.pdf"), f("e.pdf"), f("f.pdf"), f("g.pdf")]);
    });
    expect(reasons).toEqual(["too_many"]);
    expect(result.current.files).toHaveLength(ASK_FILES_MAX);
    expect(uploadAskAttachment).toHaveBeenCalledTimes(ASK_FILES_MAX);
  });

  it("judges a file by extension or MIME, and judges a call against what an earlier call staged", () => {
    const { result } = setup();
    let reasons: string[] = [];
    act(() => {
      reasons = result.current.add([
        f("notes.md", 5, ""), // browsers give no MIME for .md
        f("export.csv", 5, "application/vnd.ms-excel"), // Excel on Windows
        f("scan", 5, "image/png"), // no extension, MIME known
        f("sheet.xls", 5, "application/vnd.ms-excel"),
        f("deck.ppt", 5, ""),
        f("run.exe", 5, "application/x-msdownload"),
      ]);
    });
    expect(reasons).toEqual(["type_unsupported", "type_unsupported", "type_unsupported"]);
    expect(result.current.files.map((x) => x.file.name)).toEqual(["notes.md", "export.csv", "scan"]);
    // Two add() calls in the same tick still see each other.
    act(() => {
      reasons = [...result.current.add([f("a.pdf"), f("b.pdf")]), ...result.current.add([f("c.pdf"), f("d.pdf")])];
    });
    expect(reasons).toEqual(["too_many", "too_many"]);
    expect(result.current.files).toHaveLength(5);
  });

  it("removing a file mid-upload aborts it, and cancels it once the server has it", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf")]));
    const up = uploads[0]!;
    expect(up.signal.aborted).toBe(false);
    act(() => result.current.remove(keyOf(result, "a.pdf")));
    expect(up.signal.aborted).toBe(true);
    expect(result.current.files).toEqual([]);
    expect(deleteAskAttachment).not.toHaveBeenCalled();
    // The server had already stored it when the abort landed.
    await act(async () => up.resolve({}));
    expect(deleteAskAttachment).toHaveBeenCalledExactlyOnceWith("ws1", "id-a.pdf");
    expect(result.current.files).toEqual([]);

    // A request the abort really cut leaves nothing to cancel, and is not a failure.
    act(() => void result.current.add([f("b.pdf")]));
    const cut = uploads[1]!;
    act(() => result.current.remove(keyOf(result, "b.pdf")));
    await act(async () => cut.reject(new DOMException("Aborted", "AbortError")));
    expect(deleteAskAttachment).toHaveBeenCalledTimes(1);
    expect(result.current).toMatchObject({ files: [], blocked: false });
  });

  it("removing an uploaded file cancels it on the server and ignores a failed cancel", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf"), f("b.pdf")]));
    await act(async () => uploads[0]!.resolve({}));
    await act(async () => uploads[1]!.resolve({}));
    vi.mocked(deleteAskAttachment).mockRejectedValueOnce(new ApiError("gone", "not_found", 404));
    act(() => result.current.remove(keyOf(result, "a.pdf")));
    await act(async () => {});
    expect(deleteAskAttachment).toHaveBeenCalledExactlyOnceWith("ws1", "id-a.pdf");
    expect(result.current.files.map((x) => x.file.name)).toEqual(["b.pdf"]);
    expect(result.current.ids).toEqual(["id-b.pdf"]);
  });

  it("removing a file that failed cancels nothing", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf")]));
    await act(async () => uploads[0]!.reject(new ApiError("x", "internal", 500)));
    act(() => result.current.remove(keyOf(result, "a.pdf")));
    expect(deleteAskAttachment).not.toHaveBeenCalled();
    expect(result.current).toMatchObject({ files: [], blocked: false });
  });

  it("retry uploads the failed file again", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf")]));
    await act(async () =>
      uploads[0]!.reject(new ApiError("unreadable", "ai_attachment_unreadable", 422)),
    );
    expect(result.current.files[0]).toMatchObject({ status: "error", error: "ai_attachment_unreadable" });
    const key = result.current.files[0]!.key;
    act(() => result.current.retry(key));
    expect(result.current.files[0]).toMatchObject({ status: "uploading", progress: 0, error: undefined, key });
    expect(uploads).toHaveLength(2);
    expect(uploads[1]!.file).toBe(uploads[0]!.file);
    await act(async () => uploads[1]!.resolve({}));
    expect(result.current.files[0]).toMatchObject({ status: "ready", progress: 1, uploaded: { file_id: "id-a.pdf" } });
    // Only a failed file can be retried: a ready one is left alone.
    act(() => result.current.retry(key));
    expect(uploads).toHaveLength(2);
  });

  it("is busy while uploading and blocked while a file has failed", async () => {
    const { result } = setup();
    expect(result.current).toMatchObject({ busy: false, blocked: false, ids: [] });
    act(() => void result.current.add([f("a.pdf"), f("b.pdf")]));
    expect(result.current).toMatchObject({ busy: true, blocked: false });
    await act(async () => uploads[0]!.resolve({}));
    expect(result.current.busy).toBe(true);
    await act(async () => uploads[1]!.reject(new TypeError("Failed to fetch")));
    expect(result.current).toMatchObject({ busy: false, blocked: true });
    expect(result.current.files[1]).toMatchObject({ status: "error", error: "upload_failed" });
    act(() => result.current.remove(result.current.files[1]!.key));
    expect(result.current).toMatchObject({ busy: false, blocked: false });
  });

  it("an answer without a file id is a failed upload", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf")]));
    await act(async () => uploads[0]!.resolve({ file_id: "" }));
    expect(result.current.files[0]).toMatchObject({ status: "error", error: "upload_failed" });
    expect(result.current.ids).toEqual([]);
  });

  it("reports progress as a fraction", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf")]));
    act(() => uploads[0]!.onProgress(4, 8));
    expect(result.current.files[0]!.progress).toBe(0.5);
    act(() => uploads[0]!.onProgress(1, 0));
    expect(result.current.files[0]!.progress).toBe(0);
  });

  it("ids lists only uploaded files in attach order", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf"), f("b.pdf"), f("c.pdf")]));
    await act(async () => uploads[2]!.resolve({}));
    expect(result.current.ids).toEqual(["id-c.pdf"]);
    await act(async () => uploads[0]!.resolve({}));
    expect(result.current.ids).toEqual(["id-a.pdf", "id-c.pdf"]);
    await act(async () => uploads[1]!.resolve({}));
    expect(result.current.ids).toEqual(["id-a.pdf", "id-b.pdf", "id-c.pdf"]);
  });

  it("askDisplayAttachments shows the uploaded files in attach order, under their upload ids", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf", 7), f("b.pdf"), f("c.pdf", 9, "image/png")]));
    await act(async () => uploads[2]!.resolve({ kind: "image" }));
    await act(async () => uploads[0]!.resolve({}));
    await act(async () => uploads[1]!.reject(new TypeError("Failed to fetch")));
    expect(askDisplayAttachments(result.current.files)).toEqual([
      { id: "id-a.pdf", name: "a.pdf", mime: "application/pdf", size: 7, kind: "pdf" },
      { id: "id-c.pdf", name: "c.pdf", mime: "image/png", size: 9, kind: "image" },
    ]);
  });

  it("clear empties the list after a send and leaves the files on the server", async () => {
    const { result } = setup();
    act(() => void result.current.add([f("a.pdf"), f("b.pdf")]));
    await act(async () => uploads[0]!.resolve({}));
    act(() => result.current.clear());
    expect(result.current).toMatchObject({ files: [], ids: [], busy: false, blocked: false });
    // The unfinished one is cut; if the server answers anyway it is cancelled like a removed file.
    expect(uploads[1]!.signal.aborted).toBe(true);
    expect(deleteAskAttachment).not.toHaveBeenCalled();
    await act(async () => uploads[1]!.resolve({}));
    expect(deleteAskAttachment).toHaveBeenCalledExactlyOnceWith("ws1", "id-b.pdf");
    // The room is free again.
    act(() => void result.current.add([f("c.pdf")]));
    expect(result.current.files).toHaveLength(1);
  });

  it("a workspace switch cuts the uploads and forgets the files", async () => {
    const { result, rerender } = setup("ws1");
    act(() => void result.current.add([f("a.pdf")]));
    rerender({ ws: "ws2" });
    expect(uploads[0]!.signal.aborted).toBe(true);
    expect(result.current.files).toEqual([]);
    await act(async () => uploads[0]!.resolve({}));
    // The file belongs to the workspace it was uploaded to.
    expect(deleteAskAttachment).toHaveBeenCalledExactlyOnceWith("ws1", "id-a.pdf");
    act(() => void result.current.add([f("b.pdf")]));
    expect(vi.mocked(uploadAskAttachment).mock.calls.at(-1)![0]).toBe("ws2");
  });
});

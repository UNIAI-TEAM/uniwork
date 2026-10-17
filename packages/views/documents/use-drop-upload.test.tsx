import { act, renderHook, waitFor } from "@testing-library/react";
import type { DragEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { useDropUpload } from "./use-drop-upload";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

function dragEvent(types: string[], files: File[] = []) {
  const dataTransfer = { types, files, dropEffect: "none" };
  const event = { dataTransfer, preventDefault: vi.fn() };
  return { event: event as unknown as DragEvent, raw: event, dataTransfer };
}

function pdf(name: string) {
  return new File(["x"], name, { type: "application/pdf" });
}

beforeEach(() => {
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("useDropUpload", () => {
  it("offers no drop handlers to a viewer", () => {
    const { result } = renderHook(() => useDropUpload({ enabled: false, upload: vi.fn() }));
    expect(result.current.zoneProps).toEqual({});
    expect(result.current.active).toBe(false);
  });

  it("stays active until the pointer has left every child of the zone", () => {
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload: vi.fn() }));
    const enter = () => dragEvent(["Files"]);

    const a = enter();
    act(() => result.current.zoneProps.onDragEnter?.(a.event));
    expect(a.raw.preventDefault).toHaveBeenCalled();
    expect(result.current.active).toBe(true);

    act(() => result.current.zoneProps.onDragEnter?.(enter().event));
    act(() => result.current.zoneProps.onDragLeave?.(enter().event));
    expect(result.current.active).toBe(true);

    act(() => result.current.zoneProps.onDragLeave?.(enter().event));
    expect(result.current.active).toBe(false);

    // A stray leave never drives the depth below zero.
    act(() => result.current.zoneProps.onDragLeave?.(enter().event));
    act(() => result.current.zoneProps.onDragEnter?.(enter().event));
    expect(result.current.active).toBe(true);
  });

  it("ignores drags that carry no files, such as text or a dragged row", () => {
    const upload = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));
    const text = dragEvent(["text/plain"]);

    act(() => result.current.zoneProps.onDragEnter?.(text.event));
    act(() => result.current.zoneProps.onDragOver?.(text.event));
    act(() => result.current.zoneProps.onDragLeave?.(text.event));
    act(() => result.current.zoneProps.onDrop?.(text.event));

    expect(text.raw.preventDefault).not.toHaveBeenCalled();
    expect(text.dataTransfer.dropEffect).toBe("none");
    expect(result.current.active).toBe(false);
    expect(upload).not.toHaveBeenCalled();
  });

  it("marks a file drag as a copy", () => {
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload: vi.fn() }));
    const over = dragEvent(["Files"]);
    act(() => result.current.zoneProps.onDragOver?.(over.event));
    expect(over.raw.preventDefault).toHaveBeenCalled();
    expect(over.dataTransfer.dropEffect).toBe("copy");
  });

  it("serializes overlapping drops so the second upload starts only after the first settles", async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const upload = vi.fn(async (file: File) => {
      order.push(`start:${file.name}`);
      if (file.name === "a.pdf") await firstGate;
      order.push(`end:${file.name}`);
    });
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));

    act(() => result.current.zoneProps.onDrop?.(dragEvent(["Files"], [pdf("a.pdf")]).event));
    act(() => result.current.zoneProps.onDrop?.(dragEvent(["Files"], [pdf("b.pdf")]).event));
    await act(async () => {
      await Promise.resolve();
    });

    // B is queued, not started: the chunked hook keeps ONE active upload, so a
    // second start would overwrite it and the first toast's Cancel would act
    // on the wrong upload (R2-3).
    expect(order).toEqual(["start:a.pdf"]);

    releaseFirst();
    await waitFor(() =>
      expect(order).toEqual(["start:a.pdf", "end:a.pdf", "start:b.pdf", "end:b.pdf"]),
    );
    expect(upload).toHaveBeenCalledTimes(2);
  });

  it("uploads dropped files one after another and reports the count", async () => {
    const order: string[] = [];
    const upload = vi.fn(async (file: File) => {
      order.push(`start:${file.name}`);
      await Promise.resolve();
      order.push(`end:${file.name}`);
    });
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));

    act(() => result.current.zoneProps.onDragEnter?.(dragEvent(["Files"]).event));
    const drop = dragEvent(["Files"], [pdf("a.pdf"), pdf("b.pdf")]);
    act(() => result.current.zoneProps.onDrop?.(drop.event));

    expect(drop.raw.preventDefault).toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.drop_done", { count: 2 })));
    expect(order).toEqual(["start:a.pdf", "end:a.pdf", "start:b.pdf", "end:b.pdf"]);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("keeps going after a failed file and names the one that failed", async () => {
    const upload = vi.fn(async (file: File) => {
      if (file.name === "bad.pdf") throw "boom";
    });
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));

    act(() => result.current.zoneProps.onDrop?.(dragEvent(["Files"], [pdf("bad.pdf"), pdf("ok.pdf")]).event));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.drop_done", { count: 1 })));
    expect(upload).toHaveBeenCalledTimes(2);
    expect(toast.error).toHaveBeenCalledWith(t("documents.home.drop_failed", { name: "bad.pdf" }));
  });

  it("shows the server's message when the upload rejects with an error", async () => {
    const upload = vi.fn().mockRejectedValue(new Error("Tệp quá lớn"));
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));

    act(() => result.current.zoneProps.onDrop?.(dragEvent(["Files"], [pdf("big.pdf")]).event));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tệp quá lớn"));
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("does nothing when the drop holds no files", () => {
    const upload = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));
    act(() => result.current.zoneProps.onDrop?.(dragEvent(["Files"], []).event));
    expect(upload).not.toHaveBeenCalled();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("rejects an oversize file before calling upload while continuing with valid files", async () => {
    const upload = vi.fn(async () => {});
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));
    const huge = pdf("huge.pdf");
    Object.defineProperty(huge, "size", { value: 200 * 1024 * 1024 + 1 });
    const ok = pdf("ok.pdf");

    act(() => result.current.zoneProps.onDrop?.(dragEvent(["Files"], [huge, ok]).event));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.drop_done", { count: 1 })));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(ok);
    expect(toast.error).toHaveBeenCalledWith(
      t("documents.upload.too_large_named", { name: "huge.pdf", size: "200,1 MB", max: "200 MB" }),
    );
  });

  it("rejects an unsupported file extension before calling upload while continuing with valid files", async () => {
    const upload = vi.fn(async () => {});
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));
    const bad = new File(["x"], "installer.exe", { type: "application/octet-stream" });
    const ok = pdf("ok.pdf");

    act(() => result.current.zoneProps.onDrop?.(dragEvent(["Files"], [bad, ok]).event));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.home.drop_done", { count: 1 })));
    expect(upload).toHaveBeenCalledTimes(1);
    expect(upload).toHaveBeenCalledWith(ok);
    expect(toast.error).toHaveBeenCalledWith(
      t("documents.upload.unsupported_format", { name: "installer.exe" }),
    );
  });

  it("reads error.fields.max_bytes when a server upload rejects with 413 file_too_large", async () => {
    const upload = vi.fn().mockRejectedValue(
      new ApiError("too large", "file_too_large", 413, undefined, { max_bytes: 50 * 1024 * 1024 }),
    );
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));
    const big = pdf("big.pdf");
    Object.defineProperty(big, "size", { value: 60 * 1024 * 1024 });

    act(() => result.current.zoneProps.onDrop?.(dragEvent(["Files"], [big]).event));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        t("documents.upload.too_large_named", { name: "big.pdf", size: "60 MB", max: "50 MB" }),
      ),
    );
    expect(toast.success).not.toHaveBeenCalled();
  });
});


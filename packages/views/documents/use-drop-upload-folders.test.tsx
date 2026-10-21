import { act, renderHook, waitFor } from "@testing-library/react";
import type { DragEvent } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { useDropUpload } from "./use-drop-upload";

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

beforeEach(() => {
  for (const fn of Object.values(toast)) fn.mockReset();
  toast.loading.mockImplementation((msg: string) => `toast-${msg}`);
});

function pdf(name: string) {
  return new File(["x"], name, { type: "application/pdf" });
}

function fileEntry(name: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (f: File) => void) => ok(pdf(name)),
  } as unknown as FileSystemFileEntry;
}

function dirEntry(name: string, children: FileSystemEntry[]): FileSystemDirectoryEntry {
  return {
    isFile: false,
    isDirectory: true,
    name,
    createReader: () => {
      let served = false;
      return {
        readEntries: (ok: (e: FileSystemEntry[]) => void) => {
          ok(served ? [] : children);
          served = true;
        },
      };
    },
  } as unknown as FileSystemDirectoryEntry;
}

/** A drop as the browser hands it: `files` lists directories too, `items` tells them apart. */
function drop(items: { entry?: FileSystemEntry; file?: File }[]) {
  const dataItems = items.map((item) => ({
    kind: "file",
    webkitGetAsEntry: () => item.entry ?? null,
    getAsFile: () => item.file ?? null,
  }));
  const files = items.map((item) => item.file ?? pdf(item.entry?.name ?? "dir"));
  const dataTransfer = { types: ["Files"], files, items: dataItems, dropEffect: "none" };
  return { preventDefault: vi.fn(), dataTransfer } as unknown as DragEvent;
}

describe("useDropUpload folders (UNI-2052)", () => {
  it("hands dropped folders to onFolders and keeps loose files on the old queue", async () => {
    const upload = vi.fn(async () => {});
    const onFolders = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload, onFolders }));
    const loose = pdf("loose.pdf");

    act(() =>
      result.current.zoneProps.onDrop?.(
        drop([
          { entry: dirEntry("Báo cáo", [fileEntry("a.pdf"), dirEntry("2026", [fileEntry("b.pdf")])]) },
          { entry: fileEntry("loose.pdf") as FileSystemEntry, file: loose },
        ]),
      ),
    );

    await waitFor(() => expect(onFolders).toHaveBeenCalledTimes(1));
    const lists = onFolders.mock.calls[0]?.[0] as { path: string }[][];
    expect(lists).toHaveLength(1);
    expect(lists[0]?.map((entry) => entry.path)).toEqual(["Báo cáo/a.pdf", "Báo cáo/2026/b.pdf"]);
    await waitFor(() => expect(upload).toHaveBeenCalledWith(loose));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("gives every dropped folder its own list, in drop order", async () => {
    const onFolders = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload: vi.fn(), onFolders }));
    act(() =>
      result.current.zoneProps.onDrop?.(
        drop([{ entry: dirEntry("A", [fileEntry("1.pdf")]) }, { entry: dirEntry("B", [fileEntry("2.pdf")]) }]),
      ),
    );
    await waitFor(() => expect(onFolders).toHaveBeenCalledTimes(1));
    const lists = onFolders.mock.calls[0]?.[0] as { path: string }[][];
    expect(lists.map((list) => list[0]?.path)).toEqual(["A/1.pdf", "B/2.pdf"]);
  });

  it("skips folders with one toast when folder upload is not available, loose files still go up", async () => {
    const upload = vi.fn(async () => {});
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));
    const loose = pdf("loose.pdf");

    act(() =>
      result.current.zoneProps.onDrop?.(
        drop([
          { entry: dirEntry("A", [fileEntry("1.pdf")]) },
          { entry: dirEntry("B", [fileEntry("2.pdf")]) },
          { entry: fileEntry("loose.pdf") as FileSystemEntry, file: loose },
        ]),
      ),
    );

    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(toast.info).toHaveBeenCalledWith(t("documents.folder_upload.toast.folders_unavailable"));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(loose));
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("does not walk anything for a drop of plain files", async () => {
    const upload = vi.fn(async () => {});
    const onFolders = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload, onFolders }));
    const a = pdf("a.pdf");
    act(() => result.current.zoneProps.onDrop?.(drop([{ entry: fileEntry("a.pdf") as FileSystemEntry, file: a }])));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(a));
    expect(onFolders).not.toHaveBeenCalled();
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("says so when a folder cannot be read and uploads nothing from it", async () => {
    const broken = dirEntry("Hỏng", []);
    broken.createReader = () => ({ readEntries: (_ok: unknown, fail: (e: Error) => void) => fail(new Error("denied")) }) as never;
    const onFolders = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload: vi.fn(), onFolders }));
    act(() => result.current.zoneProps.onDrop?.(drop([{ entry: broken }])));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.folder_upload.toast.read_failed")));
    expect(onFolders).not.toHaveBeenCalled();
  });
});

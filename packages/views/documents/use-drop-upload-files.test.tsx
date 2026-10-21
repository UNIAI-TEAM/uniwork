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

// ADDENDUM 2: two or more loose files in one drop are ONE files-mode run
// (`onFiles`); a single loose file keeps the old one-file flow, and without
// folder upload on the server the old queue uploads them one by one.
describe("useDropUpload loose files (UNI-2052 ADDENDUM 2)", () => {
  it("hands two or more dropped files to onFiles as one run and uploads none of them itself", async () => {
    const upload = vi.fn(async () => {});
    const onFiles = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload, onFolders: vi.fn(), onFiles }));
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    act(() => result.current.zoneProps.onDrop?.(drop([{ file: a }, { file: b }])));
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([a, b]));
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps a single dropped file on the old one-file flow", async () => {
    const upload = vi.fn(async () => {});
    const onFiles = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload, onFolders: vi.fn(), onFiles }));
    const a = pdf("a.pdf");
    act(() => result.current.zoneProps.onDrop?.(drop([{ file: a }])));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(a));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("stages each dropped folder and then the loose files as one files-mode run", async () => {
    const upload = vi.fn(async () => {});
    const order: string[] = [];
    const onFolders = vi.fn(() => order.push("folders"));
    const onFiles = vi.fn(() => order.push("files"));
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload, onFolders, onFiles }));
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    act(() =>
      result.current.zoneProps.onDrop?.(
        drop([
          { entry: dirEntry("Báo cáo", [fileEntry("x.pdf")]) },
          { entry: fileEntry("a.pdf") as FileSystemEntry, file: a },
          { entry: fileEntry("b.pdf") as FileSystemEntry, file: b },
        ]),
      ),
    );
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([a, b]));
    expect(order).toEqual(["folders", "files"]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("keeps one loose file beside a folder on the old flow", async () => {
    const upload = vi.fn(async () => {});
    const onFiles = vi.fn();
    const onFolders = vi.fn();
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload, onFolders, onFiles }));
    const a = pdf("a.pdf");
    act(() =>
      result.current.zoneProps.onDrop?.(
        drop([{ entry: dirEntry("Báo cáo", [fileEntry("x.pdf")]) }, { entry: fileEntry("a.pdf") as FileSystemEntry, file: a }]),
      ),
    );
    await waitFor(() => expect(onFolders).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(upload).toHaveBeenCalledWith(a));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("waits for the config before choosing between one run and the old queue", async () => {
    const upload = vi.fn(async () => {});
    const onFiles = vi.fn();
    const { result, rerender } = renderHook(
      (props: { ready: boolean; multi: boolean }) =>
        useDropUpload({ enabled: true, upload, foldersReady: props.ready, onFiles: props.multi ? onFiles : undefined }),
      { initialProps: { ready: false, multi: false } },
    );
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    act(() => result.current.zoneProps.onDrop?.(drop([{ file: a }, { file: b }])));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(upload).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
    rerender({ ready: true, multi: true });
    await waitFor(() => expect(onFiles).toHaveBeenCalledWith([a, b]));
    expect(upload).not.toHaveBeenCalled();
  });

  it("uploads the files one by one on the old queue when the server has no folder upload (A8)", async () => {
    const upload = vi.fn(async () => {});
    const { result } = renderHook(() => useDropUpload({ enabled: true, upload }));
    const a = pdf("a.pdf");
    const b = pdf("b.pdf");
    act(() => result.current.zoneProps.onDrop?.(drop([{ file: a }, { file: b }])));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload).toHaveBeenNthCalledWith(1, a);
    expect(upload).toHaveBeenNthCalledWith(2, b);
  });
});

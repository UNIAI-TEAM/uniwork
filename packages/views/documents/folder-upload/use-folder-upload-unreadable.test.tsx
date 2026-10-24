import { QueryClient } from "@tanstack/react-query";
import { act, configure, fireEvent, getConfig, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from "@uniwork/core/api/endpoints/config";
import {
  createFakeFolderUploadTransport,
  type FakeFolderUploadOptions,
  type FolderUploadEntry,
} from "@uniwork/core/documents/folder-upload";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { DesktopPlatformGuess, OfficeLaunchOutcome } from "@uniwork/core/office";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import type { OfficeHomeLaunchProps } from "../../office/office-home-launch";
import { wrap } from "../../test/api-mock";
import { useFolderUpload, type UseFolderUploadOptions } from "./use-folder-upload";

const toast = vi.hoisted(() => ({
  loading: vi.fn(),
  success: vi.fn(),
  warning: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  dismiss: vi.fn(),
}));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WITH_FOLDERS: DocumentLimits = {
  ...DEFAULT_DOCUMENT_LIMITS,
  folder_upload: { max_files: 500, max_folders: 500, max_total_bytes: 2 * 1024 ** 3, max_depth: 20, parallel: 4, complete_batch: 50 },
};

const windows: DesktopPlatformGuess = { platform: "win32-x64", confidence: "certain" };

function node(id: string, title: string, children: DocumentTreeNode[] = []): DocumentTreeNode {
  return { id, title, kind: "folder", position: 1, children };
}

function pdf(path: string): File {
  const file = new File(["x"], path.split("/").pop() as string, { type: "application/pdf" });
  Object.defineProperty(file, "webkitRelativePath", { value: path });
  return file;
}

// Edge: a path past 260 characters is a size-0 File whose bytes cannot be read.
class UnstatableFile extends File {
  constructor(
    name: string,
    private readonly read: () => Promise<ArrayBuffer> = () => Promise.reject(new DOMException("not found", "NotFoundError")),
  ) {
    super(["x"], name, { type: "application/pdf" });
  }
  override get size(): number {
    return 0;
  }
  override arrayBuffer(): Promise<ArrayBuffer> {
    return this.read();
  }
}

type Spec = string | UnstatableFile;

function entries(root: string, names: Spec[]): FolderUploadEntry<File>[] {
  return names.map((spec) => {
    const file = typeof spec === "string" ? pdf(`${root}/${spec}`) : spec;
    return { path: `${root}/${file.name}`, size: file.size, file };
  });
}

let hook: ReturnType<typeof useFolderUpload>;

function Harness(props: UseFolderUploadOptions) {
  hook = useFolderUpload(props);
  return <>{hook.dialogs}</>;
}

function officeHome(over: Partial<OfficeHomeLaunchProps> = {}): OfficeHomeLaunchProps {
  return {
    channel: "stable",
    launch: vi.fn(async (): Promise<OfficeLaunchOutcome> => "launched"),
    loadInstallers: vi.fn(async () => ({ installers: [] })),
    loadPlatformHint: vi.fn(async () => windows),
    downloadInstaller: vi.fn(async () => "UniWork-Office.exe"),
    ...over,
  };
}

function setup(over: Partial<UseFolderUploadOptions> = {}, fake: FakeFolderUploadOptions = {}) {
  const transport = createFakeFolderUploadTransport(fake);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: UseFolderUploadOptions = {
    wsId: "ws-1",
    enabled: true,
    folderId: "folder-open",
    destinationName: "Hợp đồng",
    tree: [node("my-folder", "My", [node("folder-open", "Hợp đồng", [])])],
    limits: WITH_FOLDERS,
    myFolderId: "my-folder",
    resolveRootParent: vi.fn(async () => "my-folder"),
    parentShared: false,
    onOpenFolder: vi.fn(),
    transport,
    officeHome: officeHome(),
    ...over,
  };
  render(wrap(<Harness {...props} />, queryClient));
  return { transport, props };
}

const stage = (...lists: FolderUploadEntry<File>[][]) => act(() => hook.addFolders(lists));
const heading = (name: string) => screen.findByRole("heading", { name });

let asyncUtilTimeout = 0;
beforeAll(() => {
  asyncUtilTimeout = getConfig().asyncUtilTimeout;
  configure({ asyncUtilTimeout: 8_000 });
});
afterAll(() => configure({ asyncUtilTimeout }));

beforeEach(async () => {
  await setLocale("vi");
  for (const fn of Object.values(toast)) fn.mockReset();
});

describe("useFolderUpload: files the browser cannot read", () => {
  it("opens today's dialog for a readable empty file", async () => {
    setup();
    stage(entries("Mới", ["a.pdf", new UnstatableFile("empty.pdf", async () => new ArrayBuffer(0))]));
    expect(await heading("Tải lên thư mục")).toBeInTheDocument();
    expect(screen.queryByText(/Tệp bị ảnh hưởng/)).toBeNull();
  });

  it("warns, writes nothing, and uploads the rest through the runner; the report names the skipped file with the new sentence", async () => {
    const { transport } = setup({}, { putFailures: { "long.pdf": ["network"] } });
    stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf"), "b.pdf"]));
    expect(await heading("Có 1 tệp trình duyệt không đọc được")).toBeInTheDocument();
    expect(transport.calls).toEqual([]);
    expect(screen.getByRole("listitem")).toHaveTextContent("long.pdf");

    fireEvent.click(screen.getByRole("button", { name: "Tải 2 tệp còn lại" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalled());
    const [message, options] = toast.warning.mock.calls[0] ?? [];
    expect(message).toBe("2/3 tệp đã tải lên · 1 lỗi");
    act(() => {
      options.action.onClick();
    });
    const reason = await screen.findByText(/Trình duyệt không đọc được tệp này vì đường dẫn trên máy quá dài/);
    expect(reason).toHaveTextContent("Mở UniWork Office để tải thư mục này, hoặc chép thư mục vào chỗ có đường dẫn ngắn hơn rồi tải lại.");
  });

  it("hands the folder to the app: the dialog closes, nothing is written, an info toast holds for 12 s", async () => {
    const { transport, props } = setup();
    stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf")]));
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(props.officeHome?.launch).toHaveBeenCalledWith("uniwork-office://home", expect.anything());
    expect(toast.info).toHaveBeenCalledOnce();
    expect(toast.info.mock.calls[0]?.[0]).toBe(
      "Đã mở UniWork Office. Trong ứng dụng, bấm Tải lên › Tải lên thư mục rồi chọn lại thư mục này.",
    );
    expect(toast.info.mock.calls[0]?.[1]).toMatchObject({ duration: 12_000 });
    expect(transport.calls).toEqual([]);
    expect(toast.loading).not.toHaveBeenCalled();
  });

  it("a launch that outlives its dialog never dismisses the next staged folder", async () => {
    let finish: (outcome: OfficeLaunchOutcome) => void = () => undefined;
    const launch = vi.fn(() => new Promise<OfficeLaunchOutcome>((resolve) => { finish = resolve; }));
    setup({ officeHome: officeHome({ launch }) });
    stage(entries("Một", ["a.pdf", new UnstatableFile("long.pdf")]), entries("Hai", ["b.pdf"]));
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await screen.findByRole("button", { name: "Đang mở…" });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(await screen.findByTestId("folder-upload-root")).toHaveTextContent("Hai");
    await act(async () => {
      finish("launched");
    });
    expect(screen.getByTestId("folder-upload-root")).toHaveTextContent("Hai");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("Hủy writes nothing and shows no hand-off toast", async () => {
    const { transport } = setup();
    stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf")]));
    fireEvent.click(await screen.findByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(transport.calls).toEqual([]);
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("checks loose files too, with the files nouns and the files menu path", async () => {
    setup();
    act(() => hook.addFiles([pdf("a.pdf"), pdf("b.pdf"), new UnstatableFile("long.pdf")]));
    expect(await heading("Có 1 tệp trình duyệt không đọc được")).toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent("UniWork Office tải được các tệp này.");
    expect(screen.getByRole("note")).toHaveTextContent("Tải lên › Tải lên tệp");
    expect(screen.getByRole("button", { name: "Tải 2 tệp còn lại" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở UniWork Office" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalled());
    expect(toast.info.mock.calls[0]?.[0]).toContain("Tải lên tệp rồi chọn lại các tệp này.");
  });

  it("opens the dialog only past 400 ms of probing, in the checking state, then turns into the warning", async () => {
    let release: () => void = () => undefined;
    const slow = new UnstatableFile(
      "long.pdf",
      () => new Promise<ArrayBuffer>((_, reject) => { release = () => reject(new DOMException("not found", "NotFoundError")); }),
    );
    setup();
    stage(entries("Mới", ["a.pdf", slow]));
    expect(screen.queryByRole("dialog")).toBeNull();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("status")).toHaveTextContent("Đang kiểm tra thư mục…");
    expect(within(dialog).getByRole("button", { name: t("documents.folder_upload.dialog.submit") })).toHaveAttribute("aria-disabled", "true");
    act(() => release());
    expect(await heading("Có 1 tệp trình duyệt không đọc được")).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("opens at once for a pick with no empty file (no probe, no flash)", () => {
    setup();
    stage(entries("Mới", ["a.pdf"]));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("has no app to open without host wiring: the rest is the primary", async () => {
    setup({ officeHome: undefined });
    stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf")]));
    expect(await heading("Có 1 tệp trình duyệt không đọc được")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mở UniWork Office" })).toBeNull();
    expect(screen.getByRole("note")).toHaveTextContent("Chép thư mục vào chỗ có đường dẫn ngắn hơn");
  });
});

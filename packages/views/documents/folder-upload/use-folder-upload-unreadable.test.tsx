import { QueryClient } from "@tanstack/react-query";
import { act, configure, fireEvent, getConfig, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DOCUMENT_LIMITS, type DocumentLimits } from "@uniwork/core/api/endpoints/config";
import {
  createFakeFolderUploadTransport,
  findUnreadable,
  type FakeFolderUploadOptions,
  type FolderUploadEntry,
} from "@uniwork/core/documents/folder-upload";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { DesktopPlatformGuess, OfficeInstallerOption, OfficeLaunchOutcome } from "@uniwork/core/office";
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
// Pass-through, so a test can read the signal the probe was given.
vi.mock("@uniwork/core/documents/folder-upload", async (importOriginal) => {
  const original = await importOriginal<typeof import("@uniwork/core/documents/folder-upload")>();
  return { ...original, findUnreadable: vi.fn(original.findUnreadable) };
});

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
    const reason = await screen.findByText(/Trình duyệt không đọc được tệp này, thường do đường dẫn trên máy quá dài/);
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
    // No installer on this server: the toast text alone, no action that leads to a dead dialog.
    expect(toast.info.mock.calls[0]?.[1]?.action).toBeUndefined();
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

const slowFile = (name: string) => {
  let release: () => void = () => undefined;
  const file = new UnstatableFile(
    name,
    () => new Promise<ArrayBuffer>((_, reject) => { release = () => reject(new DOMException("not found", "NotFoundError")); }),
  );
  return { file, release: () => release() };
};

describe("useFolderUpload: the focus follows the dialog into the warning (R2-1)", () => {
  it("moves to Mở UniWork Office when a slow probe turns the checking dialog into the warning", async () => {
    const slow = slowFile("long.pdf");
    setup();
    stage(entries("Mới", ["a.pdf", slow.file]));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("status")).toBeInTheDocument();
    act(() => slow.release());
    expect(await heading("Có 1 tệp trình duyệt không đọc được")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Mở UniWork Office" })).toHaveFocus());
  });

  it("moves to the rest when there is no app to open", async () => {
    const slow = slowFile("long.pdf");
    setup({ officeHome: undefined });
    stage(entries("Mới", ["a.pdf", slow.file]));
    await screen.findByRole("dialog");
    act(() => slow.release());
    expect(await heading("Có 1 tệp trình duyệt không đọc được")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Tải 1 tệp còn lại" })).toHaveFocus());
  });
});

describe("useFolderUpload: a launch answers to the pick it began for (R2-2)", () => {
  const twoWarned = () =>
    stage(entries("Một", ["a.pdf", new UnstatableFile("long.pdf")]), entries("Hai", ["b.pdf", new UnstatableFile("deep.pdf")]));

  it("leaves the next pick's buttons live and opens no install prompt over it", async () => {
    let finish: (outcome: OfficeLaunchOutcome) => void = () => undefined;
    const launch = vi.fn(() => new Promise<OfficeLaunchOutcome>((resolve) => { finish = resolve; }));
    setup({ officeHome: officeHome({ launch }) });
    twoWarned();
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await screen.findByRole("button", { name: "Đang mở…" });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.getByTestId("folder-upload-root")).toHaveTextContent("Hai"));
    const primary = await screen.findByRole("button", { name: "Mở UniWork Office" });
    expect(primary).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("button", { name: "Tải 1 tệp còn lại" })).not.toHaveAttribute("aria-disabled");
    expect(screen.queryByRole("button", { name: "Đang mở…" })).toBeNull();
    await act(async () => {
      finish("not-installed");
    });
    expect(screen.queryByRole("dialog", { name: "Tải UniWork Office cho máy tính" })).toBeNull();
    expect(screen.getByRole("button", { name: "Mở UniWork Office" })).not.toHaveAttribute("aria-disabled");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("lets the next pick open the app while the first launch is still pending", async () => {
    const launch = vi.fn(() => new Promise<OfficeLaunchOutcome>(() => undefined));
    setup({ officeHome: officeHome({ launch }) });
    twoWarned();
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await screen.findByRole("button", { name: "Đang mở…" });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.getByTestId("folder-upload-root")).toHaveTextContent("Hai"));
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    expect(launch).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("button", { name: "Đang mở…" })).toBeInTheDocument();
  });
});

const windowsInstaller: OfficeInstallerOption = {
  platform: "win32-x64",
  url: "https://downloads.test/UniWork-Office.exe",
  kind: "exe",
  channel: "stable",
};
const installPrompt = () => screen.queryByRole("dialog", { name: "Tải UniWork Office cho máy tính" });

describe("useFolderUpload: Mở UniWork Office closes the warning whatever the outcome (UNI-2152 fix 2)", () => {
  it.each<OfficeLaunchOutcome>(["launched", "not-installed", "error"])(
    "%s: the warning is gone, the head is dismissed with no server call, the toast shows, no install dialog opens",
    async (outcome) => {
      const launch = vi.fn(async (): Promise<OfficeLaunchOutcome> => outcome);
      const { transport } = setup({ officeHome: officeHome({ launch }) });
      stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf")]));
      fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
      await waitFor(() => expect(toast.info).toHaveBeenCalledOnce());
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(toast.info.mock.calls[0]?.[0]).toBe(t("documents.folder_upload.unreadable.handoff_a"));
      expect(toast.info.mock.calls[0]?.[1]).toMatchObject({ duration: 12_000 });
      expect(transport.calls).toEqual([]);
      expect(installPrompt()).toBeNull();
    },
  );

  it("files mode: the same, with the files wording", async () => {
    const launch = vi.fn(async (): Promise<OfficeLaunchOutcome> => "not-installed");
    setup({ officeHome: officeHome({ launch }) });
    act(() => hook.addFiles([pdf("a.pdf"), new UnstatableFile("long.pdf")]));
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledOnce());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(toast.info.mock.calls[0]?.[0]).toBe(t("documents.folder_upload.unreadable.handoff_a", { context: "files" }));
  });

  it("the toast action opens the install prompt alone; Để sau leaves a clean page", async () => {
    const launch = vi.fn(async (): Promise<OfficeLaunchOutcome> => "not-installed");
    const home = officeHome({ launch, loadInstallers: vi.fn(async () => ({ installers: [windowsInstaller] })) });
    setup({ officeHome: home });
    stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf")]));
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledOnce());
    const options = toast.info.mock.calls[0]?.[1];
    expect(options).toMatchObject({ duration: 12_000, action: { label: "Chưa cài UniWork Office?" } });
    expect(installPrompt()).toBeNull();
    act(() => {
      options.action.onClick();
    });
    const prompt = await screen.findByRole("dialog", { name: "Tải UniWork Office cho máy tính" });
    // Alone: the warning is already closed, nothing sits behind it.
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(screen.queryByRole("heading", { name: /trình duyệt không đọc được/ })).toBeNull();
    fireEvent.click(within(prompt).getByRole("button", { name: "Để sau" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(home.loadInstallers).toHaveBeenCalledOnce();
  });

  it("the toast action still opens the prompt when the next staged folder is already showing", async () => {
    const home = officeHome({ loadInstallers: vi.fn(async () => ({ installers: [windowsInstaller] })) });
    setup({ officeHome: home });
    stage(entries("Một", ["a.pdf", new UnstatableFile("long.pdf")]), entries("Hai", ["b.pdf"]));
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledOnce());
    expect(await screen.findByTestId("folder-upload-root")).toHaveTextContent("Hai");
    act(() => {
      toast.info.mock.calls[0]?.[1].action.onClick();
    });
    expect(await screen.findByRole("dialog", { name: "Tải UniWork Office cho máy tính" })).toBeInTheDocument();
  });

  it("has no action when the installer list is empty, or cannot be loaded", async () => {
    const loadInstallers = vi.fn(async (): Promise<{ installers: OfficeInstallerOption[] }> => {
      throw new Error("down");
    });
    setup({ officeHome: officeHome({ launch: vi.fn(async (): Promise<OfficeLaunchOutcome> => "not-installed"), loadInstallers }) });
    stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf")]));
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await waitFor(() => expect(toast.info).toHaveBeenCalledOnce());
    expect(toast.info.mock.calls[0]?.[1]?.action).toBeUndefined();
  });

  it("loads the installers once for the page, not once per pick", async () => {
    const home = officeHome({ loadInstallers: vi.fn(async () => ({ installers: [windowsInstaller] })) });
    setup({ officeHome: home });
    for (const root of ["Một", "Hai"]) {
      stage(entries(root, ["a.pdf", new UnstatableFile("long.pdf")]));
      fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    }
    expect(toast.info).toHaveBeenCalledTimes(2);
    expect(home.loadInstallers).toHaveBeenCalledOnce();
  });

  it("an aborted launch (Hủy while Đang mở…) shows nothing, whatever it ends with", async () => {
    let finish: (outcome: OfficeLaunchOutcome) => void = () => undefined;
    const launch = vi.fn(() => new Promise<OfficeLaunchOutcome>((resolve) => { finish = resolve; }));
    setup({ officeHome: officeHome({ launch, loadInstallers: vi.fn(async () => ({ installers: [windowsInstaller] })) }) });
    stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf")]));
    fireEvent.click(await screen.findByRole("button", { name: "Mở UniWork Office" }));
    await screen.findByRole("button", { name: "Đang mở…" });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await act(async () => {
      finish("not-installed");
    });
    expect(toast.info).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("useFolderUpload: cancelling the probe (R2-3)", () => {
  it.each([
    ["Hủy", () => fireEvent.click(screen.getByRole("button", { name: "Hủy" }))],
    ["Esc", () => fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" })],
  ])("%s during the checking dialog aborts the probe and dismisses the head", async (_name, leave) => {
    const slow = slowFile("long.pdf");
    setup();
    stage(entries("Một", ["a.pdf", slow.file]), entries("Hai", ["b.pdf"]));
    await screen.findByRole("status");
    const signal = vi.mocked(findUnreadable).mock.calls.at(-1)?.[1]?.signal;
    expect(signal?.aborted).toBe(false);
    act(() => {
      leave();
    });
    await waitFor(() => expect(screen.getByTestId("folder-upload-root")).toHaveTextContent("Hai"));
    expect(signal?.aborted).toBe(true);
  });
});

describe("useFolderUpload: the platform hint loads once, before any pick (R2-5)", () => {
  it("never shows the app button on a device with no installer", async () => {
    const loadPlatformHint = vi.fn(async (): Promise<DesktopPlatformGuess> => ({ platform: null, confidence: "unsupported" }));
    setup({ officeHome: officeHome({ loadPlatformHint }) });
    await waitFor(() => expect(loadPlatformHint).toHaveBeenCalledOnce());
    await act(async () => undefined);
    stage(entries("Mới", ["a.pdf", new UnstatableFile("long.pdf")]));
    expect(await heading("Có 1 tệp trình duyệt không đọc được")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mở UniWork Office" })).toBeNull();
    expect(screen.getByRole("button", { name: "Tải 1 tệp còn lại" })).toBeInTheDocument();
    stage(entries("Hai", ["b.pdf", new UnstatableFile("deep.pdf")]));
    expect(loadPlatformHint).toHaveBeenCalledOnce();
  });
});

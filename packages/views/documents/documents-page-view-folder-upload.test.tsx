import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// Folder upload on the Documents home (UNI-2052): the entries exist only when
// the server's config carries the folder_upload block and the viewer may
// create here; a dropped folder opens the pre-flight dialog.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
vi.mock("@uniwork/core/api/http", async (original) => {
  const { requestMock: transport } = await import("../test/request-mock");
  return { ...(await original<typeof import("@uniwork/core/api/http")>()), request: (...args: unknown[]) => transport(...args) };
});

const { t } = initI18n();

const WS = "ws1";
const BASE = `/api/v1/workspaces/${WS}/documents`;
const user = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};
const FOLDER_LIMITS = { max_files: 500, max_folders: 500, max_total_bytes: 2 * 1024 ** 3, max_depth: 20, parallel: 4, complete_batch: 50 };

function route({
  folderUpload,
  folder,
  configGate,
}: {
  folderUpload: boolean;
  folder?: Record<string, unknown>;
  /** Holds the answer of GET /config until it resolves. */
  configGate?: Promise<void>;
}) {
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith("/api/v1/config")) {
      const answer = {
        flags: { office_engine: true },
        documents: { limits: { upload_max_bytes: 200 * 1024 * 1024, ...(folderUpload ? { folder_upload: FOLDER_LIMITS } : {}) } },
      };
      return configGate ? configGate.then(() => answer) : Promise.resolve(answer);
    }
    if (folder && path.startsWith(`${BASE}/${folder.id as string}`)) return Promise.resolve(folder);
    if (path.startsWith(`${BASE}/tree`)) return Promise.resolve({ documents: folder ? [{ ...folder, position: 0, children: [] }] : [] });
    if (path.startsWith(BASE)) return Promise.resolve({ documents: [], next_cursor: null });
    return Promise.resolve({});
  });
}

function nav(folderId?: string): NavigationAdapter {
  return {
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents",
    searchParams: new URLSearchParams(folderId ? `folder=${folderId}` : ""),
    getShareableUrl: (p) => p,
  };
}

function renderView(adapter: NavigationAdapter = nav()) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrap(
      <NavigationProvider value={adapter}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
}

function fileEntry(name: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    name,
    file: (ok: (f: File) => void) => ok(new File(["x"], name, { type: "application/pdf" })),
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

/** The toolbar Upload once the config has turned it into a menu (it acts as a plain button until then). */
const screenWithFolderUpload = () =>
  waitFor(() => {
    const trigger = screen.getByRole("button", { name: t("documents.folder_upload.menu_label") });
    expect(trigger).toHaveAttribute("aria-haspopup", "menu");
    return trigger;
  });

const configLoaded = () =>
  waitFor(() => expect(requestMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/config"))).toBe(true));

beforeEach(() => {
  requestMock.mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} });
});

describe("Documents home folder upload entries (UNI-2052)", () => {
  it("offers Tải lên thư mục in the toolbar menu and the New menu when the server has folder uploads", async () => {
    route({ folderUpload: true });
    renderView();
    const trigger = await screenWithFolderUpload();
    fireEvent.click(trigger);
    expect(await screen.findByRole("menuitem", { name: t("documents.folder_upload.menu_file") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.folder_upload.menu_folder") })).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.home.create.menu")) }));
    expect(await screen.findAllByRole("menuitem", { name: t("documents.folder_upload.menu_folder") })).not.toHaveLength(0);
  });

  it("keeps the single Tải lên button and no folder entry when the config has no folder_upload block", async () => {
    route({ folderUpload: false });
    renderView();
    const upload = await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    await configLoaded();
    expect(upload).not.toHaveAttribute("aria-haspopup");
    expect(screen.queryByTestId("folder-upload-input")).toBeNull();
  });

  it("sends two or more files picked in Tải lên tệp to the files-mode pre-flight, one file to the single-file dialog (A5)", async () => {
    route({ folderUpload: true });
    renderView();
    fireEvent.click(await screenWithFolderUpload());
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.folder_upload.menu_file") }));
    const input = (await screen.findByLabelText(t("documents.upload.pick"))) as HTMLInputElement;
    expect(input).toHaveAttribute("multiple");
    const a = new File(["x"], "a.pdf", { type: "application/pdf" });
    const b = new File(["y"], "b.pdf", { type: "application/pdf" });
    fireEvent.change(input, { target: { files: [a, b] } });
    const dialog = await screen.findByTestId("folder-upload-dialog");
    expect(dialog).toHaveAttribute("data-mode", "files");
    expect(within(dialog).queryByTestId("folder-upload-root")).toBeNull();
    expect(within(dialog).getByTestId("folder-upload-summary")).toHaveTextContent("2 tệp");
    expect(within(dialog).getByTestId("folder-upload-destination")).toHaveTextContent(t("documents.home.my_folder.label"));
    expect(screen.queryByLabelText(t("documents.upload.pick"))).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.folder_upload.dialog.cancel") }));
    await waitFor(() => expect(screen.queryByTestId("folder-upload-dialog")).toBeNull());

    fireEvent.click(await screenWithFolderUpload());
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.folder_upload.menu_file") }));
    const again = (await screen.findByLabelText(t("documents.upload.pick"))) as HTMLInputElement;
    fireEvent.change(again, { target: { files: [a] } });
    expect(screen.getByTestId("document-upload-selected")).toHaveTextContent("a.pdf");
    expect(screen.queryByTestId("folder-upload-dialog")).toBeNull();
  });

  it("keeps the Tải lên tệp picker single-file when the config has no folder_upload block (A8)", async () => {
    route({ folderUpload: false });
    renderView();
    const upload = await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    await configLoaded();
    fireEvent.click(upload);
    const input = (await screen.findByLabelText(t("documents.upload.pick"))) as HTMLInputElement;
    expect(input).not.toHaveAttribute("multiple");
  });

  it("queues two dropped files one by one, with no multi-file run, when the config has no folder_upload block (A8)", async () => {
    route({ folderUpload: false });
    renderView();
    await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    await configLoaded();
    const zone = screen.getByRole("region", { name: t("documents.page.title") });
    const a = new File(["x"], "a.pdf", { type: "application/pdf" });
    const b = new File(["y"], "b.pdf", { type: "application/pdf" });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [a, b], items: [], dropEffect: "none" } });
    });
    await waitFor(() =>
      expect(toast.loading).toHaveBeenCalledWith(t("documents.upload.drop_queued", { name: "b.pdf" }), expect.anything()),
    );
    expect(screen.queryByTestId("folder-upload-dialog")).toBeNull();
  });

  it("opens the pre-flight dialog for a folder dropped on the library, destination My Folder at the root", async () => {
    route({ folderUpload: true });
    renderView();
    await screenWithFolderUpload();
    const zone = screen.getByRole("region", { name: t("documents.page.title") });
    const items = [{ kind: "file", webkitGetAsEntry: () => dirEntry("Báo cáo", [fileEntry("a.pdf")]), getAsFile: () => null }];
    const dataTransfer = { types: ["Files"], files: [], items, dropEffect: "none" };
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer });
    });
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("folder-upload-root")).toHaveTextContent("Báo cáo");
    expect(within(dialog).getByTestId("folder-upload-destination")).toHaveTextContent(t("documents.home.my_folder.label"));
    expect(within(dialog).getByTestId("folder-upload-summary")).toHaveTextContent("1 tệp");
  });

  it("opens one files-mode pre-flight for a folder's sibling files dropped with it, after the folder's (A6)", async () => {
    route({ folderUpload: true });
    renderView();
    await screenWithFolderUpload();
    const zone = screen.getByRole("region", { name: t("documents.page.title") });
    const a = new File(["x"], "a.pdf", { type: "application/pdf" });
    const b = new File(["y"], "b.pdf", { type: "application/pdf" });
    const items = [
      { kind: "file", webkitGetAsEntry: () => dirEntry("Báo cáo", [fileEntry("x.pdf")]), getAsFile: () => null },
      { kind: "file", webkitGetAsEntry: () => fileEntry("a.pdf"), getAsFile: () => a },
      { kind: "file", webkitGetAsEntry: () => fileEntry("b.pdf"), getAsFile: () => b },
    ];
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [], items, dropEffect: "none" } });
    });
    const dialog = await screen.findByTestId("folder-upload-dialog");
    expect(dialog).toHaveAttribute("data-mode", "folder");
    expect(within(dialog).getByText(t("documents.folder_upload.dialog.queue_more", { count: 1 }))).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: t("documents.folder_upload.dialog.cancel") }));
    await waitFor(() => expect(screen.getByTestId("folder-upload-dialog")).toHaveAttribute("data-mode", "files"));
    expect(screen.getByTestId("folder-upload-summary")).toHaveTextContent("2 tệp");
    expect(screen.queryByTestId("folder-upload-root")).toBeNull();
  });

  it("skips a dropped folder with one toast when the server has no folder uploads", async () => {
    route({ folderUpload: false });
    renderView();
    await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    await configLoaded();
    const zone = screen.getByRole("region", { name: t("documents.page.title") });
    const items = [{ kind: "file", webkitGetAsEntry: () => dirEntry("Báo cáo", [fileEntry("a.pdf")]), getAsFile: () => null }];
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [], items, dropEffect: "none" } });
    });
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith(t("documents.folder_upload.toast.folders_unavailable")));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("offers no folder entry in a folder the viewer cannot edit", async () => {
    route({
      folderUpload: true,
      folder: { id: "f1", workspace_id: WS, kind: "folder", title: "Chỉ đọc", revision: "1", my_level: "view", updated_at: "2026-09-28T03:00:00Z" },
    });
    renderView(nav("f1"));
    await screen.findByText("Chỉ đọc");
    await configLoaded();
    expect(screen.queryByTestId("folder-upload-input")).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.home.create.upload.button") })).toBeNull();
  });

  it("keeps the same toolbar Upload element when the config resolves with folder upload (RF15)", async () => {
    let release: () => void = () => {};
    route({ folderUpload: true, configGate: new Promise<void>((resolve) => (release = resolve)) });
    renderView();
    const before = await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    expect(before).not.toHaveAttribute("aria-haspopup");
    release();
    const after = await screenWithFolderUpload();
    expect(after).toBe(before);
  });

  it("waits for the config before judging a dropped folder instead of calling folder upload unavailable (RF15)", async () => {
    let release: () => void = () => {};
    route({ folderUpload: true, configGate: new Promise<void>((resolve) => (release = resolve)) });
    renderView();
    await screen.findByRole("button", { name: t("documents.home.create.upload.button") });
    const zone = screen.getByRole("region", { name: t("documents.page.title") });
    const items = [{ kind: "file", webkitGetAsEntry: () => dirEntry("Báo cáo", [fileEntry("a.pdf")]), getAsFile: () => null }];
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [], items, dropEffect: "none" } });
    });
    expect(toast.info).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();

    release();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByTestId("folder-upload-root")).toHaveTextContent("Báo cáo");
    expect(toast.info).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { configureRuntime, resetRuntimeConfig } from "@uniwork/core/runtime-config";
import type { User, Workspace } from "@uniwork/core/types";
import { createFakeDrivePickerAdapter } from "../../integrations/drive-picker";
import type { DrivePickerOpenResult } from "../../integrations/drive-picker/drive-picker-adapter";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { DocumentsPageView } from "../documents-page-view";
import { DriveLibraryListView } from "./drive-library-list-view";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

const { t } = initI18n();

const WS = "ws1";
const FOLDERS_URL = `/api/v1/workspaces/${WS}/drive-folders`;
const DRIVE_LIST_URL = `/api/v1/workspaces/${WS}/drive-files`;
const DRIVE_HOME = "/acme/doi/documents?view=drive";

const sessionUser = {
  id: "u1",
  email: "minh@example.com",
  display_name: "Minh",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
} as User;

const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const connections: DriveConnectionSummary[] = [
  { id: "conn1", google_email: "uni-work1@gmail.com", needs_reconnect: false, linked_file_count: 5 },
];

const connectionWire = {
  id: "conn1",
  provider: "google",
  google_email: "uni-work1@gmail.com",
  status: "active",
  needs_reconnect: false,
  linked_file_count: 5,
  connected_at: "2026-10-26T09:42:00Z",
  updated_at: "2026-10-26T09:42:00Z",
};

function driveFile(id: string, name: string, folder: { id: string; name: string | null } | null) {
  return {
    id,
    organization_id: "org1",
    workspace_id: WS,
    external_file_id: `ext-${id}`,
    name,
    mime_type: "application/vnd.google-apps.document",
    icon_kind: "google_doc",
    web_view_link: `https://docs.google.com/document/d/ext-${id}/edit`,
    open_url: `https://docs.google.com/document/d/ext-${id}/edit`,
    owner_display: "Lan",
    sharing_state: "private",
    connection_id: "conn1",
    bound_account_email: "uni-work1@gmail.com",
    bound_connection_lost: false,
    bound_by_id: "u1",
    bound_by_name: "Minh",
    created_by: "u1",
    created_by_kind: "human",
    created_by_name: "Minh",
    created_at: "2026-10-26T08:15:00Z",
    updated_at: "2026-10-26T08:15:00Z",
    viewer_access: "granted",
    viewer_connection_id: "conn1",
    viewer_account_email: "uni-work1@gmail.com",
    can_unlink: true,
    can_rebind: true,
    can_propose: true,
    can_ask: true,
    used_in_count: 0,
    used_in_tasks: [],
    tasks_created: { count: 0 },
    drive_folder: folder,
  };
}

const BETA = { id: "fld-beta", name: "Dự án Beta" };
const ALPHA = { id: "fld-alpha", name: "Alpha" };
const UNNAMED = { id: "1xYz9Qabcdef", name: null };
const UNNAMED_LABEL = "Thư mục trên Drive · 1xYz9Q";

const FILES = [
  driveFile("f1", "Kế hoạch Beta", BETA),
  driveFile("f2", "Ngân sách Beta", BETA),
  driveFile("f3", "Tổng quan Alpha", ALPHA),
  driveFile("f4", "Biên bản chưa xếp", UNNAMED),
  driveFile("f5", "Tệp ở gốc", null),
];

// The server counts differ from what the first pages hold on purpose: the tree must show the server's numbers.
const FOLDER_GROUPS = {
  folders: [
    { id: ALPHA.id, name: ALPHA.name, file_count: 1 },
    { id: BETA.id, name: BETA.name, file_count: 7 },
    { id: UNNAMED.id, name: null, file_count: 1 },
    { id: null, name: null, file_count: 1 },
  ],
};

interface Serve {
  folders?: () => Promise<unknown>;
  name?: (body: unknown) => Promise<unknown>;
  connectionList?: unknown[];
}

function serve(opts: Serve = {}) {
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    if (path === "/api/v1/config") {
      return Promise.resolve({ flags: { documents: true, drive_connector: true }, rum_sample_rate: 0, drive: { available: true } });
    }
    if (path.startsWith(FOLDERS_URL) && init?.method === "POST") {
      return (opts.name ?? (() => Promise.resolve({ drive_folder: { id: UNNAMED.id, name: "Hợp đồng" }, updated_count: 1 })))(init.body);
    }
    if (path.startsWith(FOLDERS_URL)) return (opts.folders ?? (() => Promise.resolve(FOLDER_GROUPS)))();
    if (path.startsWith(DRIVE_LIST_URL)) {
      // Like the server: the folder filter (`none` = no parent) narrows the files and the total.
      const folder = new URLSearchParams(path.split("?")[1] ?? "").get("drive_folder_id");
      const files = folder === null ? FILES : FILES.filter((f) => (folder === "none" ? !f.drive_folder : f.drive_folder?.id === folder));
      return Promise.resolve({ files, total_count: files.length, next_cursor: null, drive_folder_id: folder });
    }
    if (path === `/api/v1/workspaces/${WS}/drive-connections`) {
      return Promise.resolve({ connections: opts.connectionList ?? [connectionWire] });
    }
    if (path.endsWith("/picker-token")) {
      return Promise.resolve({ access_token: "tok", expires_at: "2026-10-26T12:00:00Z", developer_key: "dev", app_id: "app" });
    }
    if (path.includes("/documents/tree")) return Promise.resolve({ documents: [] });
    if (path.includes("/documents")) return Promise.resolve({ documents: [], next_cursor: null });
    return Promise.resolve({});
  });
}

const callsTo = (prefix: string, method?: string) =>
  requestMock.mock.calls.filter(
    ([path, init]) => String(path).startsWith(prefix) && (method ? (init as { method?: string } | undefined)?.method === method : true),
  );
const folderGets = () => callsTo(FOLDERS_URL).filter(([, init]) => (init as { method?: string } | undefined)?.method !== "POST");
const namePosts = () => callsTo(FOLDERS_URL, "POST");
const filesOfAccount = () =>
  callsTo(DRIVE_LIST_URL).filter(([path]) => new URLSearchParams(String(path).split("?")[1] ?? "").get("connection_id") === "conn1");
/** The `drive_folder_id` of each GET drive-files for the account, in order (null = no filter). */
const folderFilters = () =>
  filesOfAccount().map(([path]) => new URLSearchParams(String(path).split("?")[1] ?? "").get("drive_folder_id"));

function withFlag(ui: React.ReactElement, nav = fakeNav()) {
  const service = new FeatureFlagService(
    new StaticProvider({ documents: { default: true }, drive_connector: { default: true } }),
  );
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={sessionUser}>
      <FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>
    </WorkspaceProvider>,
    nav,
  );
}

function renderDocuments(url: string) {
  const nav = fakeNav(url);
  render(withFlag(<DocumentsPageView wsId={WS} onOpen={vi.fn()} driveConnections={connections} />, nav));
  return nav;
}

function renderList(url: string, folderId: string | null, adapter = createFakeDrivePickerAdapter()) {
  const nav = fakeNav(url);
  render(
    withFlag(
      <DriveLibraryListView
        wsId={WS}
        accountId="conn1"
        folderId={folderId}
        connections={connections}
        pickerAdapter={adapter}
      />,
      nav,
    ),
  );
  return { nav, adapter };
}

const expandAccount = () =>
  fireEvent.click(screen.getByRole("button", { name: t("documents.tree.expand", { title: "uni-work1@gmail.com" }) }));

const pickedFolder = (id: string): DrivePickerOpenResult => ({
  status: "picked",
  files: [{ id, name: "Hợp đồng", mimeType: "application/vnd.google-apps.folder", sharingState: "private" }],
});

const UNNAMED_URL = `${DRIVE_HOME}&account=conn1&driveFolder=${UNNAMED.id}`;

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(sessionUser);
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetRuntimeConfig();
});

describe("folder tree from the server list", () => {
  it("shows the server's folders and counts in one request, with no page walk, and no node for files without a folder", async () => {
    renderDocuments(DRIVE_HOME);
    await screen.findByRole("button", { name: /Drive: uni-work1@gmail\.com/ });
    expandAccount();

    const beta = await screen.findByRole("button", { name: /Dự án Beta/ });
    const alpha = screen.getByRole("button", { name: /Alpha/ });
    const unnamed = screen.getByRole("button", { name: new RegExp(`^${UNNAMED_LABEL}`) });
    expect(alpha.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(beta.compareDocumentPosition(unnamed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(beta).toHaveTextContent("7");
    expect(alpha).toHaveTextContent("1");
    expect(within(screen.getByRole("button", { name: /Drive: uni-work1@gmail\.com/ })).queryByText(/Tệp ở gốc/)).toBeNull();

    expect(folderGets()).toHaveLength(1);
    expect(String(folderGets()[0]![0])).toBe(`${FOLDERS_URL}?drive_connection_id=conn1`);
    expect(filesOfAccount()).toHaveLength(0);
  });

  it.each([
    ["a 404", () => Promise.reject(new ApiError("not found", "not_found", 404))],
    ["an answer with no list", () => Promise.resolve({ unexpected: true })],
  ])("shows the folder error on %s and derives nothing from the files", async (_label, folders) => {
    serve({ folders });
    renderDocuments(DRIVE_HOME);
    await screen.findByRole("button", { name: /Drive: uni-work1@gmail\.com/ });
    expandAccount();

    const error = await screen.findByText(t("driveLibrary.sidebar.folders_error"));
    expect(error).toBeInTheDocument();
    // The error text starts on the folder-name column (76px in the row), not the icon column (48px).
    expect(error).toHaveStyle({ paddingLeft: "76px" });
    expect(screen.queryByRole("button", { name: /Dự án Beta/ })).toBeNull();
    expect(filesOfAccount()).toHaveLength(0);
  });

  it("the loading row keeps its spinner on the icon column and its text on the folder-name column", async () => {
    serve({ folders: () => new Promise(() => {}) });
    renderDocuments(DRIVE_HOME);
    await screen.findByRole("button", { name: /Drive: uni-work1@gmail\.com/ });
    expandAccount();

    const row = await screen.findByRole("status");
    expect(row).toHaveStyle({ paddingLeft: "48px" });
    // 20px icon slot + 8px gap puts the text at 76px, the name column of a folder row.
    expect(row.firstElementChild).toHaveClass("size-5", "shrink-0");
  });

  it("an empty list is a valid answer and shows no folders", async () => {
    serve({ folders: () => Promise.resolve({ folders: [] }) });
    renderDocuments(DRIVE_HOME);
    await screen.findByRole("button", { name: /Drive: uni-work1@gmail\.com/ });
    expandAccount();
    await waitFor(() => expect(folderGets()).toHaveLength(1));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.queryByRole("button", { name: /Dự án Beta/ })).toBeNull();
    expect(filesOfAccount()).toHaveLength(0);
  });
});

describe("account view with the server list", () => {
  it("lists the server's folders as rows with their counts, then only the files without a folder", async () => {
    renderDocuments(`${DRIVE_HOME}&account=conn1`);
    await screen.findByRole("link", { name: "Tệp ở gốc" });
    const table = screen.getByRole("table");
    const beta = within(table).getByRole("link", { name: /Dự án Beta/ });
    expect(beta.closest("tr")).toHaveTextContent(t("driveLibrary.folder.count", { count: 7 }));
    expect(within(table).getByRole("link", { name: new RegExp(UNNAMED_LABEL) })).toBeInTheDocument();
    // Files that sit in a folder are not in the account's own list.
    expect(within(table).queryByRole("link", { name: "Kế hoạch Beta" })).toBeNull();
    expect(within(table).queryByRole("link", { name: "Biên bản chưa xếp" })).toBeNull();
  });

  it("an unknown folder id shows the account view and never asks the server for that folder", async () => {
    renderDocuments(`${DRIVE_HOME}&account=conn1&driveFolder=nope`);
    await screen.findByRole("link", { name: "Tệp ở gốc" });
    expect(screen.queryByRole("navigation", { name: t("driveLibrary.list.breadcrumb_label") })).toBeNull();
    expect(folderFilters()).toEqual(["none"]);
  });

  it("a folder view shows the files the server filtered to that folder, in one request", async () => {
    renderDocuments(`${DRIVE_HOME}&account=conn1&driveFolder=${BETA.id}`);
    await screen.findByRole("link", { name: "Kế hoạch Beta" });
    expect(screen.getByRole("link", { name: "Ngân sách Beta" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Tệp ở gốc" })).toBeNull();
    expect(folderFilters()).toEqual([BETA.id]);
  });
});

describe("Name this folder", () => {
  it("offers the header action on an unnamed folder only", async () => {
    renderList(UNNAMED_URL, UNNAMED.id);
    expect(await screen.findByRole("button", { name: t("driveLibrary.folder.name_action") })).toBeInTheDocument();
  });

  it("does not offer it on a named folder", async () => {
    renderList(`${DRIVE_HOME}&account=conn1&driveFolder=${BETA.id}`, BETA.id);
    await screen.findByRole("link", { name: "Kế hoạch Beta" });
    expect(screen.queryByRole("button", { name: t("driveLibrary.folder.name_action") })).toBeNull();
  });

  it("opens the folder Picker for that folder, names it, toasts and refetches folders and files", async () => {
    const success = vi.spyOn(toast, "success");
    const adapter = createFakeDrivePickerAdapter(pickedFolder(UNNAMED.id));
    renderList(UNNAMED_URL, UNNAMED.id, adapter);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: t("driveLibrary.folder.name_action") }));

    await waitFor(() => expect(namePosts()).toHaveLength(1));
    expect(adapter.calls).toHaveLength(1);
    expect(adapter.calls[0]).toMatchObject({ selectFolder: true, multiselect: false });
    expect(String(namePosts()[0]![0])).toBe(`${FOLDERS_URL}/${UNNAMED.id}/name`);
    expect((namePosts()[0]![1] as { body: unknown }).body).toEqual({ drive_connection_id: "conn1" });
    await waitFor(() => expect(success).toHaveBeenCalledWith(t("driveLibrary.folder.name_done")));
    // 200 -> the folder list and the account's files are asked for again.
    await waitFor(() => expect(folderGets().length).toBeGreaterThan(1));
    expect(filesOfAccount().length).toBeGreaterThan(1);
    // It never links the picked folder as a file.
    expect(callsTo(DRIVE_LIST_URL, "POST")).toHaveLength(0);
  });

  it("does not post when the picked id is not the folder asked for", async () => {
    const error = vi.spyOn(toast, "error");
    renderList(UNNAMED_URL, UNNAMED.id, createFakeDrivePickerAdapter(pickedFolder("another-folder")));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: t("driveLibrary.folder.name_action") }));

    await waitFor(() => expect(error).toHaveBeenCalledWith(t("driveLibrary.folder.name_mismatch")));
    expect(namePosts()).toHaveLength(0);
  });

  it("ignores a second request while the name is still being posted", async () => {
    serve({ name: () => new Promise(() => {}) });
    const adapter = createFakeDrivePickerAdapter(pickedFolder(UNNAMED.id));
    renderList(UNNAMED_URL, UNNAMED.id, adapter);
    const user = userEvent.setup();
    const action = await screen.findByRole("button", { name: t("driveLibrary.folder.name_action") });
    await user.click(action);
    await waitFor(() => expect(namePosts()).toHaveLength(1));

    await user.click(action);
    await user.click(action);
    expect(adapter.calls).toHaveLength(1);
    expect(namePosts()).toHaveLength(1);
  });

  it("does nothing when the Picker is cancelled", async () => {
    const error = vi.spyOn(toast, "error");
    const adapter = createFakeDrivePickerAdapter({ status: "cancelled" });
    renderList(UNNAMED_URL, UNNAMED.id, adapter);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: t("driveLibrary.folder.name_action") }));

    await waitFor(() => expect(adapter.calls).toHaveLength(1));
    expect(namePosts()).toHaveLength(0);
    expect(error).not.toHaveBeenCalled();
  });

  it.each([
    ["404 drive_folder_not_found", new ApiError("x", "drive_folder_not_found", 404), "driveLibrary.folder.name_not_found"],
    ["422 drive_folder_not_folder", new ApiError("x", "drive_folder_not_folder", 422), "driveLibrary.folder.name_not_folder"],
    ["429 drive_unavailable", new ApiError("x", "drive_unavailable", 429), "driveLibrary.folder.name_unavailable"],
    ["503 drive_unavailable", new ApiError("x", "drive_unavailable", 503), "driveLibrary.folder.name_unavailable"],
    ["a connection lost", new ApiError("x", "auth_failed", 401), "drive.picker.errors.token_failed"],
    ["any other failure", new ApiError("x", "internal", 500), "driveLibrary.folder.name_failed"],
  ])("answers %s with its own toast and leaves the lists alone", async (_label, failure, key) => {
    const error = vi.spyOn(toast, "error");
    const success = vi.spyOn(toast, "success");
    serve({ name: () => Promise.reject(failure) });
    renderList(UNNAMED_URL, UNNAMED.id, createFakeDrivePickerAdapter(pickedFolder(UNNAMED.id)));
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: t("driveLibrary.folder.name_action") }));

    await waitFor(() => expect(error).toHaveBeenCalledWith(t(key)));
    expect(success).not.toHaveBeenCalled();
    expect(folderGets()).toHaveLength(1);
  });
});

describe("nameFolder=1", () => {
  it("opens the flow once for an unnamed folder and drops the param", async () => {
    const adapter = createFakeDrivePickerAdapter({ status: "cancelled" });
    const { nav } = renderList(`${UNNAMED_URL}&nameFolder=1`, UNNAMED.id, adapter);

    await waitFor(() => expect(adapter.calls).toHaveLength(1));
    expect(adapter.calls[0]).toMatchObject({ selectFolder: true });
    expect(nav.replace).toHaveBeenCalledTimes(1);
    const url = String(vi.mocked(nav.replace).mock.calls[0]![0]);
    expect(url).not.toContain("nameFolder");
    expect(url).toContain(`driveFolder=${UNNAMED.id}`);
    // Re-renders after the drop do not open it again.
    await screen.findByRole("button", { name: t("driveLibrary.folder.name_action") });
    expect(adapter.calls).toHaveLength(1);
  });

  it("is dropped without opening when the folder is already named or unknown", async () => {
    const named = createFakeDrivePickerAdapter();
    const first = renderList(`${DRIVE_HOME}&account=conn1&driveFolder=${BETA.id}&nameFolder=1`, BETA.id, named);
    await waitFor(() => expect(first.nav.replace).toHaveBeenCalledTimes(1));
    expect(named.calls).toHaveLength(0);

    const unknown = createFakeDrivePickerAdapter();
    const second = renderList(`${DRIVE_HOME}&account=conn1&driveFolder=nope&nameFolder=1`, "nope", unknown);
    await waitFor(() => expect(second.nav.replace).toHaveBeenCalledTimes(1));
    expect(unknown.calls).toHaveLength(0);
  });

  it("is ignored without the param", async () => {
    const adapter = createFakeDrivePickerAdapter();
    const { nav } = renderList(UNNAMED_URL, UNNAMED.id, adapter);
    await screen.findByRole("button", { name: t("driveLibrary.folder.name_action") });
    expect(adapter.calls).toHaveLength(0);
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

describe("Name this folder from the sidebar", () => {
  it("overlays the action on the count instead of reserving room beside it", async () => {
    renderDocuments(`${DRIVE_HOME}&account=conn1`);
    const trigger = await screen.findByRole("button", { name: t("driveLibrary.folder.menu_aria", { name: UNNAMED_LABEL }) });
    expect(trigger).toHaveClass("absolute", "opacity-0", "group-hover/row:opacity-100", "group-focus-within/row:opacity-100");
    // The unnamed row's count steps aside while the action shows; a named row keeps its count.
    const unnamedCount = trigger.closest("div")!.querySelector("button .font-mono");
    expect(unnamedCount).toHaveClass("group-hover/row:invisible", "group-focus-within/row:invisible");
    const betaCount = screen.getByRole("button", { name: /^Dự án Beta/ }).querySelector(".font-mono");
    expect(betaCount).not.toHaveClass("group-hover/row:invisible");
  });

  it("opens the Picker from the unnamed node's menu and names the folder", async () => {
    configureRuntime({ allowFakeDrivePicker: true });
    const calls: unknown[] = [];
    window.__UNIWORK_FAKE_DRIVE_PICKER__ = (options) => {
      calls.push(options);
      return pickedFolder(UNNAMED.id);
    };
    try {
      const success = vi.spyOn(toast, "success");
      renderDocuments(`${DRIVE_HOME}&account=conn1`);
      const user = userEvent.setup();
      await user.click(await screen.findByRole("button", { name: t("driveLibrary.folder.menu_aria", { name: UNNAMED_LABEL }) }));
      await user.click(await screen.findByRole("menuitem", { name: t("driveLibrary.folder.name_action") }));

      await waitFor(() => expect(namePosts()).toHaveLength(1));
      expect(calls).toHaveLength(1);
      expect(String(namePosts()[0]![0])).toBe(`${FOLDERS_URL}/${UNNAMED.id}/name`);
      await waitFor(() => expect(success).toHaveBeenCalledWith(t("driveLibrary.folder.name_done")));
    } finally {
      delete window.__UNIWORK_FAKE_DRIVE_PICKER__;
    }
  });
});

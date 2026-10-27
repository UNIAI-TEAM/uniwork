import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { DocumentsPageView } from "../documents-page-view";
import { DriveSidebarSection } from "./drive-sidebar-section";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

const { t } = initI18n();

const WS = "ws1";
const CONFIG_URL = "/api/v1/config";
const DRIVE_LIST_URL = `/api/v1/workspaces/${WS}/drive-files`;
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
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
  { id: "conn2", google_email: "uni-work2@gmail.com", needs_reconnect: false, linked_file_count: 2 },
];

function driveFile(id: string, name: string, connection: string, folder?: { id: string; name: string | null } | null) {
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
    connection_id: connection,
    bound_account_email: `${connection}@gmail.com`,
    bound_connection_lost: false,
    bound_by_id: "u1",
    bound_by_name: "Minh",
    created_by: "u1",
    created_by_kind: "human",
    created_by_name: "Minh",
    created_at: "2026-10-26T08:15:00Z",
    updated_at: "2026-10-26T08:15:00Z",
    viewer_access: "granted",
    viewer_connection_id: connection,
    viewer_account_email: `${connection}@gmail.com`,
    can_unlink: true,
    can_rebind: true,
    can_propose: true,
    can_ask: true,
    used_in_count: 0,
    used_in_tasks: [],
    tasks_created: { count: 0 },
    ...(folder === undefined ? {} : { drive_folder: folder }),
  };
}

const BETA = { id: "fld-beta", name: "Dự án Beta" };
const ALPHA = { id: "fld-alpha", name: "Alpha" };
const UNNAMED = { id: "1xYz9Qabcdef", name: null };
const UNNAMED_LABEL = "Thư mục trên Drive · 1xYz9Q";

/** Two accounts: named, unnamed and null `drive_folder` mixed, as the server will send them. */
const FILES_BY_ACCOUNT: Record<string, ReturnType<typeof driveFile>[]> = {
  conn1: [
    driveFile("f1", "Kế hoạch Beta", "conn1", BETA),
    driveFile("f2", "Ngân sách Beta", "conn1", BETA),
    driveFile("f3", "Tổng quan Alpha", "conn1", ALPHA),
    driveFile("f4", "Biên bản chưa xếp", "conn1", UNNAMED),
    driveFile("f5", "Tệp ở gốc", "conn1", null),
  ],
  conn2: [
    driveFile("g1", "Hợp đồng", "conn2", { id: "g-fld", name: null }),
    driveFile("g2", "Tệp rời", "conn2", null),
  ],
};

function serve(filesByAccount: Record<string, unknown[]> = FILES_BY_ACCOUNT) {
  requestMock.mockImplementation((path: string) => {
    if (path === CONFIG_URL) {
      return Promise.resolve({ flags: { documents: true, drive_connector: true }, rum_sample_rate: 0, drive: { available: true } });
    }
    if (path.startsWith(DRIVE_LIST_URL)) {
      const account = new URLSearchParams(path.split("?")[1] ?? "").get("connection_id") ?? "";
      const files = account ? (filesByAccount[account] ?? []) : Object.values(filesByAccount).flat();
      return Promise.resolve({ files, total_count: files.length, next_cursor: null });
    }
    if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
    if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
    return Promise.resolve({});
  });
}

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

const accountChevron = (email: string, expanded: boolean) =>
  screen.getByRole("button", { name: t(expanded ? "documents.tree.collapse" : "documents.tree.expand", { title: email }) });

/** The loaded list: waits for a row, because the loading skeleton is also a table. */
async function readyTable(rowName: string) {
  await screen.findByRole("link", { name: rowName });
  return screen.getByRole("table");
}

const listedAccounts = () =>
  requestMock.mock.calls
    .map(([path]) => String(path))
    .filter((path) => path.startsWith(DRIVE_LIST_URL))
    .map((path) => new URLSearchParams(path.split("?")[1] ?? "").get("connection_id") ?? "");

beforeEach(() => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser(sessionUser);
  serve();
});

describe("Drive folder tree in the sidebar", () => {
  it("expands an account into its folders (named A-Z, then unnamed) with counts, fetching only that account", async () => {
    renderDocuments(DRIVE_HOME);
    await screen.findByRole("button", { name: /Drive: uni-work1@gmail\.com/ });
    expect(screen.queryByRole("button", { name: /Alpha/ })).toBeNull();
    expect(listedAccounts()).not.toContain("conn1");

    fireEvent.click(accountChevron("uni-work1@gmail.com", false));

    const alpha = await screen.findByRole("button", { name: /Alpha/ });
    const beta = screen.getByRole("button", { name: /Dự án Beta/ });
    const unnamed = screen.getByRole("button", { name: new RegExp(UNNAMED_LABEL) });
    expect(alpha.compareDocumentPosition(beta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(beta.compareDocumentPosition(unnamed) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(alpha).toHaveTextContent("1");
    expect(beta).toHaveTextContent("2");
    expect(unnamed).toHaveTextContent("1");
    // Same tree grid: icon starts at x=56 under the account email, 20px icon box, name, count.
    expect(beta).toHaveStyle({ paddingLeft: "56px" });
    expect(beta.firstElementChild).toHaveClass("size-5", "shrink-0");
    expect(screen.getByRole("button", { name: t("documents.tree.collapse", { title: "uni-work1@gmail.com" }) })).toHaveAttribute("aria-expanded", "true");
    expect(listedAccounts()).not.toContain("conn2");
    // The account's own row keeps its linked-file count.
    expect(screen.getByRole("button", { name: /Drive: uni-work1@gmail\.com/ })).toHaveTextContent("5");
  });

  it("collapses an account again and keeps the account row selectable apart from its chevron", async () => {
    const nav = renderDocuments(DRIVE_HOME);
    await screen.findByRole("button", { name: /Drive: uni-work1@gmail\.com/ });
    fireEvent.click(accountChevron("uni-work1@gmail.com", false));
    await screen.findByRole("button", { name: /Dự án Beta/ });

    fireEvent.click(accountChevron("uni-work1@gmail.com", true));
    expect(screen.getByRole("button", { name: /Dự án Beta/, hidden: true })).not.toBeVisible();
    expect(nav.push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: /Drive: uni-work1@gmail\.com/ }));
    expect(nav.push).toHaveBeenCalledWith(`${DRIVE_HOME}&account=conn1`);
    // Selecting an account opens it.
    expect(await screen.findByRole("button", { name: /Dự án Beta/ })).toBeVisible();
  });

  it("selecting a folder writes it to the URL, scopes the list and shows the breadcrumb", async () => {
    const nav = renderDocuments(`${DRIVE_HOME}&account=conn1`);
    await screen.findByRole("link", { name: "Tệp ở gốc" });

    fireEvent.click(await screen.findByRole("button", { name: /Dự án Beta/ }));
    expect(nav.push).toHaveBeenCalledWith(`${DRIVE_HOME}&account=conn1&driveFolder=fld-beta`);

    const table = await readyTable("Kế hoạch Beta");
    expect(within(table).queryByRole("link", { name: "Tệp ở gốc" })).toBeNull();
    expect(within(table).getByRole("link", { name: "Ngân sách Beta" })).toBeInTheDocument();
    expect(within(table).queryByRole("link", { name: "Tổng quan Alpha" })).toBeNull();
    // No folder rows inside a folder.
    expect(within(table).queryByRole("link", { name: "Alpha" })).toBeNull();

    expect(screen.getByRole("heading", { level: 1, name: "Dự án Beta" })).toBeInTheDocument();
    const crumbs = screen.getByRole("navigation", { name: t("driveLibrary.list.breadcrumb_label") });
    expect(within(crumbs).getByRole("link", { name: "Google Drive" })).toHaveAttribute("href", DRIVE_HOME);
    expect(within(crumbs).getByRole("link", { name: "uni-work1@gmail.com" })).toHaveAttribute("href", `${DRIVE_HOME}&account=conn1`);
    expect(within(crumbs).getByText("Dự án Beta")).toHaveAttribute("aria-current", "page");

    const sidebarBeta = screen.getAllByRole("button", { name: /Dự án Beta/ })[0]!;
    expect(sidebarBeta).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("button", { name: /Drive: uni-work1@gmail\.com/ })).not.toHaveAttribute("aria-current");

    // Crumb navigates back to the account.
    fireEvent.click(within(crumbs).getByRole("link", { name: "uni-work1@gmail.com" }));
    expect(nav.push).toHaveBeenLastCalledWith(`${DRIVE_HOME}&account=conn1`);
  });

  it("a reload on a folder URL restores account, open node and list; Back returns to the previous node", async () => {
    const nav = renderDocuments(`${DRIVE_HOME}&account=conn1&driveFolder=fld-beta`);

    const table = await readyTable("Kế hoạch Beta");
    expect(within(table).getByRole("link", { name: "Ngân sách Beta" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Dự án Beta" })).toBeInTheDocument();
    // The selected account is open without any click, with the folder marked current.
    expect(screen.getAllByRole("button", { name: /Dự án Beta/ })[0]).toHaveAttribute("aria-current", "page");

    fireEvent.click(await screen.findByRole("button", { name: /Alpha/ }));
    await readyTable("Tổng quan Alpha");

    nav.back();
    await readyTable("Kế hoạch Beta");
    expect(screen.getByRole("heading", { level: 1, name: "Dự án Beta" })).toBeInTheDocument();
  });
});

describe("Drive account and folder views in the main list", () => {
  it("an account lists folder rows first, then only the files without a folder", async () => {
    renderDocuments(`${DRIVE_HOME}&account=conn1`);
    const table = await readyTable("Tệp ở gốc");
    const rows = within(table).getAllByRole("row").slice(1);
    const labels = rows.map((row) => within(row).getAllByRole("link")[0]?.textContent);
    expect(labels).toEqual(["Alpha", "Dự án Beta", UNNAMED_LABEL, "Tệp ở gốc"]);

    const betaLink = within(table).getByRole("link", { name: "Dự án Beta" });
    expect(betaLink).toHaveAttribute("href", `${DRIVE_HOME}&account=conn1&driveFolder=fld-beta`);
    expect(betaLink.closest("tr")).toHaveTextContent(t("driveLibrary.folder.count", { count: 2 }));
    // Files inside folders are not repeated at the account level.
    expect(within(table).queryByRole("link", { name: "Kế hoạch Beta" })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: "Drive: uni-work1@gmail.com" })).toBeInTheDocument();
  });

  it("the Google Drive root stays the plain list of every account", async () => {
    renderDocuments(DRIVE_HOME);
    const table = await readyTable("Kế hoạch Beta");
    expect(within(table).getByRole("link", { name: "Hợp đồng" })).toBeInTheDocument();
    expect(within(table).queryByRole("link", { name: "Dự án Beta" })).toBeNull();
  });

  it("an unknown folder id shows the account view", async () => {
    renderDocuments(`${DRIVE_HOME}&account=conn1&driveFolder=does-not-exist`);
    const table = await readyTable("Dự án Beta");
    expect(within(table).getByRole("link", { name: "Tệp ở gốc" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Drive: uni-work1@gmail.com" })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: t("driveLibrary.list.breadcrumb_label") })).toBeNull();
  });

  it("an old server without drive_folder gives today's flat account list and no folder nodes", async () => {
    serve({
      conn1: [driveFile("f1", "Kế hoạch Beta", "conn1"), driveFile("f2", "Tệp ở gốc", "conn1")].map((f) => {
        const { drive_folder: _unused, ...rest } = f as typeof f & { drive_folder?: unknown };
        void _unused;
        return rest;
      }),
    });
    renderDocuments(`${DRIVE_HOME}&account=conn1`);
    const table = await readyTable("Kế hoạch Beta");
    expect(within(table).getByRole("link", { name: "Tệp ở gốc" })).toBeInTheDocument();
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    // The account is open (it is selected) but has no folder children.
    expect(screen.queryByRole("button", { name: new RegExp(t("driveLibrary.folder.unnamed", { id: "" })) })).toBeNull();
  });

  it("search is scoped to the node: account view filters folders and files, folder view only its files", async () => {
    renderDocuments(`${DRIVE_HOME}&account=conn1`);
    await readyTable("Dự án Beta");
    const box = screen.getByRole("searchbox", { name: t("driveLibrary.list.search_label") });

    fireEvent.change(box, { target: { value: "du an" } });
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Dự án Beta" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByRole("link", { name: "Alpha" })).toBeNull();
    expect(within(screen.getByRole("table")).queryByRole("link", { name: "Tệp ở gốc" })).toBeNull();

    fireEvent.change(box, { target: { value: "gốc" } });
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Tệp ở gốc" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByRole("link", { name: "Dự án Beta" })).toBeNull();

    fireEvent.change(box, { target: { value: "không có gì" } });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(t("driveLibrary.list.no_results_title"))).toBeInTheDocument();

    // Opening a folder starts a fresh search scoped to that folder: a file of another folder never matches.
    fireEvent.change(box, { target: { value: "" } });
    fireEvent.click(within(screen.getByRole("table")).getByRole("link", { name: "Dự án Beta" }));
    await readyTable("Kế hoạch Beta");
    const folderBox = screen.getByRole("searchbox", { name: t("driveLibrary.list.search_label") });
    expect(folderBox).toHaveValue("");
    fireEvent.change(folderBox, { target: { value: "alpha" } });
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.change(folderBox, { target: { value: "ngân" } });
    expect(within(screen.getByRole("table")).getByRole("link", { name: "Ngân sách Beta" })).toBeInTheDocument();
    expect(within(screen.getByRole("table")).queryByRole("link", { name: "Kế hoạch Beta" })).toBeNull();
  });

  it("keeps the existing empty copy for an account without files", async () => {
    serve({ conn1: [] });
    renderDocuments(`${DRIVE_HOME}&account=conn1`);
    expect(await screen.findByText(t("driveLibrary.list.empty_title"))).toBeInTheDocument();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });
});

describe("Name this folder", () => {
  function renderSection(onNameFolder?: (folder: { id: string }, connectionId: string) => void) {
    const nav = fakeNav(`${DRIVE_HOME}&account=conn1`);
    render(
      withFlag(
        <DriveSidebarSection
          wsId={WS}
          connections={connections}
          view={{ kind: "drive", account: "conn1", folder: null }}
          onSelect={vi.fn()}
          onNameFolder={onNameFolder}
        />,
        nav,
      ),
    );
  }

  it("is hidden while the server route does not exist (no handler)", async () => {
    renderSection();
    await screen.findByRole("button", { name: /Dự án Beta/ });
    expect(screen.queryByRole("button", { name: /Thao tác với thư mục/ })).toBeNull();
  });

  it("offers the action on unnamed folders only and hands the folder to the handler", async () => {
    const onNameFolder = vi.fn();
    renderSection(onNameFolder);
    await screen.findByRole("button", { name: /Dự án Beta/ });
    expect(screen.queryByRole("button", { name: t("driveLibrary.folder.menu_aria", { name: "Alpha" }) })).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: t("driveLibrary.folder.menu_aria", { name: UNNAMED_LABEL }) }));
    await user.click(await screen.findByRole("menuitem", { name: t("driveLibrary.folder.name_action") }));
    expect(onNameFolder).toHaveBeenCalledWith(expect.objectContaining({ id: UNNAMED.id, name: null }), "conn1");
  });
});

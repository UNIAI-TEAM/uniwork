import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { DriveLibraryListView } from "./drive-library-list-view";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

const { t } = initI18n();

const WS = "ws1";
const DRIVE_LIST_URL = `/api/v1/workspaces/${WS}/drive-files`;

const user = {
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

type Folder = { id: string; name: string | null } | null | undefined;

function driveFile(id: string, name: string, drive_folder: Folder) {
  return {
    id,
    organization_id: "org1",
    workspace_id: WS,
    external_file_id: `ext-${id}`,
    ...(drive_folder === undefined ? {} : { drive_folder }),
    name,
    mime_type: "application/vnd.google-apps.document",
    icon_kind: "google_doc",
    web_view_link: "https://docs.google.com/document/d/x/edit",
    open_url: "https://docs.google.com/document/d/x/edit",
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
  };
}

// The fake mix the visual stage reuses: named (two folders), unnamed, and unknown (null + absent).
const MIX = [
  driveFile("f1", "Hợp đồng A", { id: "fldBBB111222", name: "Dự án Beta" }),
  driveFile("f2", "Báo giá", { id: "fldAAA111222", name: "Alpha" }),
  driveFile("f3", "Hợp đồng B", { id: "fldBBB111222", name: "Dự án Beta" }),
  driveFile("f4", "Biên bản", { id: "1xYz9Qabcdef", name: null }),
  driveFile("f5", "Ghi chú cũ", null),
  driveFile("f6", "Tệp chưa làm mới", undefined),
];

function mockFiles(files: unknown[]) {
  requestMock.mockImplementation((path: string) => {
    if (path === "/api/v1/config") {
      return Promise.resolve({
        flags: { documents: true, drive_connector: true },
        rum_sample_rate: 0,
        drive: { available: true },
      });
    }
    if (path.startsWith(DRIVE_LIST_URL)) {
      return Promise.resolve({ files, total_count: files.length, next_cursor: null });
    }
    return Promise.resolve({});
  });
}

function renderList() {
  const service = new FeatureFlagService(
    new StaticProvider({ documents: { default: true }, drive_connector: { default: true } }),
  );
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <FeatureFlagsProvider service={service}>
          <DriveLibraryListView wsId={WS} accountId={null} connections={connections} />
        </FeatureFlagsProvider>
      </WorkspaceProvider>,
    ),
  );
}

const headerName = (label: string, count: number) =>
  t("driveLibrary.list.group.header_aria", { name: label, count });

beforeEach(() => {
  requestMock.mockReset();
  window.localStorage.clear();
  window.sessionStorage.clear();
  resetAuthStoreForTests();
  setSessionUser(user);
});

describe("DriveLibraryListView group by folder", () => {
  it("groups by folder by default: named A-Z, unnamed by short id label, unknown last, with counts", async () => {
    mockFiles(MIX);
    renderList();
    await screen.findByRole("link", { name: "Hợp đồng A" });

    const headers = screen.getAllByRole("button", { expanded: true });
    expect(headers.map((b) => b.getAttribute("aria-label"))).toEqual([
      headerName("Alpha", 1),
      headerName("Dự án Beta", 2),
      headerName(t("driveLibrary.list.group.unnamed", { id: "1xYz9Q" }), 1),
      headerName(t("driveLibrary.list.group.unknown"), 2),
    ]);
    expect(t("driveLibrary.list.group.unnamed", { id: "1xYz9Q" })).toBe("Thư mục trên Drive · 1xYz9Q");
    expect(t("driveLibrary.list.group.unknown")).toBe("Chưa rõ thư mục");
    const toggle = screen.getByRole("button", { name: t("driveLibrary.list.group.toggle") });
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("collapses and expands a group with the keyboard and remembers it for the session", async () => {
    mockFiles(MIX);
    const first = renderList();
    await screen.findByRole("link", { name: "Hợp đồng A" });
    const betaName = headerName("Dự án Beta", 2);

    const header = screen.getByRole("button", { name: betaName });
    header.focus();
    await userEvent.keyboard("{Enter}");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("link", { name: "Hợp đồng A" })).toBeNull();
    expect(screen.getByRole("link", { name: "Báo giá" })).toBeInTheDocument();

    first.unmount();
    renderList();
    await screen.findByRole("link", { name: "Báo giá" });
    const again = screen.getByRole("button", { name: betaName });
    expect(again).toHaveAttribute("aria-expanded", "false");
    again.focus();
    await userEvent.keyboard(" ");
    expect(again).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("link", { name: "Hợp đồng A" })).toBeInTheDocument();
  });

  it("shows today's flat list when the toggle is off and remembers that per viewer", async () => {
    mockFiles(MIX);
    const first = renderList();
    await screen.findByRole("link", { name: "Hợp đồng A" });

    const toggle = screen.getByRole("button", { name: t("driveLibrary.list.group.toggle") });
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
    const table = screen.getByRole("table");
    expect(within(table).getAllByRole("link").map((l) => l.textContent)).toEqual(
      MIX.map((f) => f.name),
    );

    first.unmount();
    renderList();
    await screen.findByRole("link", { name: "Hợp đồng A" });
    expect(screen.getByRole("button", { name: t("driveLibrary.list.group.toggle") })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.queryAllByRole("button", { expanded: false })).toHaveLength(0);

  });

  it("falls back to the flat list when every file has an unknown folder (old server)", async () => {
    mockFiles([driveFile("a", "Cũ 1", undefined), driveFile("b", "Cũ 2", null)]);
    renderList();
    await screen.findByRole("link", { name: "Cũ 1" });
    expect(screen.queryAllByRole("button", { expanded: true })).toHaveLength(0);
    expect(screen.queryByText(t("driveLibrary.list.group.unknown"))).toBeNull();
    // The toggle stays available and pressed.
    expect(screen.getByRole("button", { name: t("driveLibrary.list.group.toggle") })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("keeps the existing rows intact inside groups (links to the file detail)", async () => {
    mockFiles(MIX);
    renderList();
    const link = await screen.findByRole("link", { name: "Báo giá" });
    expect(link).toHaveAttribute("href", "/acme/doi/documents/drive/f2");
    await waitFor(() => expect(screen.getAllByRole("rowgroup").length).toBeGreaterThan(1));
  });
});

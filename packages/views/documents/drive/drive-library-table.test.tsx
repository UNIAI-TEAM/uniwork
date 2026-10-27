import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { DriveFile } from "@uniwork/core/drive-library";
import { initI18n } from "@uniwork/core/i18n";
import { wrapWithNav } from "../../test/api-mock";
import { DriveLibraryLoadingTable } from "./drive-library-loading-table";
import { DriveLibraryTable } from "./drive-library-table";
import type { DriveConnectionSummary } from "./use-drive-library-connections";

const { t } = initI18n();

const LONG_EMAIL = "someone.with.a.long.address@example-company.com";

function makeFile(over: Partial<DriveFile> = {}): DriveFile {
  return {
    id: "df1",
    organization_id: "org1",
    workspace_id: "ws1",
    external_file_id: "ext-1",
    name: "Kế hoạch Q4",
    mime_type: "application/vnd.google-apps.document",
    icon_kind: "google_doc",
    web_view_link: "https://docs.google.com/document/d/ext-1/edit",
    open_url: "https://docs.google.com/document/d/ext-1/edit",
    owner_display: "Lan",
    sharing_state: "shared",
    shared_user_count: 12,
    connection_id: "conn1",
    bound_account_email: LONG_EMAIL,
    bound_connection_lost: false,
    bound_by_id: "u1",
    bound_by_name: "Minh",
    created_by: "u1",
    created_by_kind: "human",
    created_by_name: "Minh",
    created_at: "2026-10-26T08:00:00Z",
    updated_at: "2026-10-26T08:00:00Z",
    viewer_access: "granted",
    drive_folder: null,
    viewer_connection_id: "conn1",
    viewer_account_email: LONG_EMAIL,
    can_unlink: true,
    can_rebind: false,
    can_propose: true,
    can_ask: true,
    used_in_count: 0,
    used_in_tasks: [],
    tasks_created: { count: 0 },
    task_creations: [],
    ...over,
  };
}

const connections = new Map<string, DriveConnectionSummary>([
  ["conn1", { id: "conn1", google_email: LONG_EMAIL, needs_reconnect: false, linked_file_count: 1 }],
]);

function renderTable() {
  return render(
    wrapWithNav(
      <DriveLibraryTable
        folders={[{ id: "folder-abcdef", name: "Dự án", shortId: "folder", fileCount: 3 }]}
        files={[makeFile()]}
        connectionById={connections}
        reconnectHref="/reconnect"
        fileHref={(id) => `/files/${id}`}
        folderHref={(id) => `/folders/${id}`}
      />,
    ),
  );
}

/** Width in px of an `md:w-<n>` class (Tailwind spacing step = 4px). */
function mdWidthPx(th: HTMLElement): number {
  const match = /(?:^|\s)md:w-(\d+)(?:\s|$)/.exec(th.className);
  if (!match) throw new Error(`no md:w-<n> class on "${th.textContent}": ${th.className}`);
  return Number(match[1]) * 4;
}

type FileRowCells = [HTMLElement, HTMLElement, HTMLElement, HTMLElement, HTMLElement];

function fileRowCells(): FileRowCells {
  const row = screen.getByRole("link", { name: "Kế hoạch Q4" }).closest("tr") as HTMLElement;
  const cells = within(row).getAllByRole("cell");
  expect(cells).toHaveLength(5);
  return cells as FileRowCells;
}

const NON_NAME_COLUMNS = ["account", "access", "used_in", "tasks_created"] as const;

describe("DriveLibraryTable column widths", () => {
  it("lays out fixed from md up: four explicit columns (496px), Name takes the rest, floor keeps Name >= 160px", () => {
    renderTable();
    const table = screen.getByRole("table");
    expect(table).toHaveClass("table-fixed", "md:min-w-[41rem]");
    expect(table).not.toHaveClass("md:table-auto");

    const widths = NON_NAME_COLUMNS.map((key) =>
      mdWidthPx(screen.getByRole("columnheader", { name: t(`driveLibrary.list.columns.${key}`) })),
    );
    expect(widths).toEqual([128, 160, 128, 80]);
    const fixedTotal = widths.reduce((sum, w) => sum + w, 0);
    expect(fixedTotal).toBe(496);
    // 41rem = 656px: the Name column never drops below 160px before the wrapper scrolls.
    expect(41 * 16 - fixedTotal).toBeGreaterThanOrEqual(160);

    const nameHeader = screen.getByRole("columnheader", { name: t("driveLibrary.list.columns.name") });
    expect(nameHeader).toHaveClass("md:w-auto");
    expect(nameHeader.className).not.toMatch(/md:min-w/);
  });

  it("lets no non-name header or cell force a nowrap width except the short Tasks created count", () => {
    renderTable();
    for (const key of NON_NAME_COLUMNS) {
      const th = screen.getByRole("columnheader", { name: t(`driveLibrary.list.columns.${key}`) });
      expect(th.className).not.toMatch(/whitespace-nowrap/);
      expect(th).toHaveClass("px-3");
    }
    const [name, account, access, used, tasks] = fileRowCells();
    expect(name.className).not.toMatch(/md:min-w/);
    // Opens with, Access, Used in wrap or truncate; Tasks created is a short count and stays on one line.
    for (const cell of [account, access, used]) expect(cell.className).not.toMatch(/whitespace-nowrap/);
    expect(tasks).toHaveClass("whitespace-nowrap");
  });

  it("truncates the Opens with email (full value in title) and lets the Access badge wrap", () => {
    renderTable();
    const [, account, access] = fileRowCells();

    const email = within(account).getByTitle(LONG_EMAIL);
    expect(email).toHaveTextContent(LONG_EMAIL);
    expect(email).toHaveClass("truncate");
    expect(email.className).not.toMatch(/max-w-48/);

    const badgeLabel = t("driveLibrary.list.access.shared_count", { count: 12 });
    const badge = within(access).getByText(badgeLabel);
    expect(badge).toHaveClass("inline-block", "max-w-full", "whitespace-normal", "break-words");
    expect(badge).not.toHaveClass("truncate");
    expect(badge).not.toHaveAttribute("title");
  });

  it("keeps the folder row count under the four non-name columns", () => {
    renderTable();
    const folderRow = screen.getByRole("link", { name: "Dự án" }).closest("tr") as HTMLElement;
    const cells = within(folderRow).getAllByRole("cell");
    expect(cells).toHaveLength(2);
    expect(cells[1]).toHaveAttribute("colspan", "4");
  });

  it("changes nothing below md: non-name cells stay hidden and the Name cell keeps its mobile sub-line", () => {
    renderTable();
    const [name, ...rest] = fileRowCells();
    for (const cell of rest) expect(cell).toHaveClass("hidden", "md:table-cell");
    for (const key of NON_NAME_COLUMNS) {
      expect(screen.getByRole("columnheader", { name: t(`driveLibrary.list.columns.${key}`) })).toHaveClass(
        "hidden",
        "md:table-cell",
      );
    }
    // Name cell: first column of the fixed table keeps w-full so it fills the 390px viewport.
    expect(screen.getByRole("columnheader", { name: t("driveLibrary.list.columns.name") })).toHaveClass("w-full");
    expect(name).toHaveClass("w-full", "max-w-0");
    const mobileLine = within(name).getByText(LONG_EMAIL).parentElement as HTMLElement;
    expect(mobileLine).toHaveClass("md:hidden");
    expect(within(mobileLine).getByText(t("driveLibrary.list.access.shared_count", { count: 12 }))).toBeInTheDocument();
  });
});

describe("DriveLibraryLoadingTable", () => {
  it("shares the loaded table's column contract so the skeleton does not jump", () => {
    render(<DriveLibraryLoadingTable />);
    const table = screen.getByRole("table");
    expect(table).toHaveClass("table-fixed", "md:min-w-[41rem]");
    expect(table).not.toHaveClass("md:table-auto");
    const widths = NON_NAME_COLUMNS.map((key) =>
      mdWidthPx(screen.getByRole("columnheader", { name: t(`driveLibrary.list.columns.${key}`) })),
    );
    expect(widths).toEqual([128, 160, 128, 80]);
    expect(screen.getByRole("columnheader", { name: t("driveLibrary.list.columns.name") })).toHaveClass("md:w-auto");
  });
});

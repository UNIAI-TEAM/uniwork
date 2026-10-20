import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentAccessReportSchema } from "@uniwork/core/types/document-access-report";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { formatWhen } from "../document-format";
import { AccessReportTable } from "./access-report-table";

// The By document table (UNI-2039 F3): one row per document, one header, the
// server sort, the row that opens onto its grants, and Revoke only where the
// server named a target — confirmed, awaited, never optimistic.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

// The real dialog still renders; the spy only records the target the report built for it.
const shared = vi.hoisted(() => ({ targets: [] as unknown[] }));
vi.mock("../share-dialog", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../share-dialog")>();
  const { createElement } = await import("react");
  return {
    ...actual,
    ShareDialog: (props: Parameters<typeof actual.ShareDialog>[0]) => {
      shared.targets.push(props.doc);
      return createElement(actual.ShareDialog, props);
    },
  };
});

const i18n = initI18n();
const { t } = i18n;
const at = (key: string, opts?: Record<string, unknown>) => t(`documents.accessReport.${key}`, opts ?? {});

const WS = "ws1";
const ORG = "o1";

const workspace: Workspace = {
  id: WS, slug: "doi", name: "Đội", organization_id: ORG, organization_slug: "acme", organization_name: "Acme",
};

const viewer: User = {
  id: "me", email: "an@example.com", display_name: "Nguyễn An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};

const owner = {
  source: "acl_owner",
  principal_type: "user",
  principal_id: "me",
  principal_name: "Nguyễn An",
  level: "manage",
  effective_level: "manage",
  active: true,
  granted_at: "2026-10-18T03:00:00Z",
};

const workspaceDefault = {
  source: "workspace",
  principal_type: "workspace",
  principal_id: WS,
  principal_name: "Đội",
  level: "view",
  effective_level: "view",
  active: true,
};

const share = {
  source: "share",
  principal_type: "user",
  principal_id: "u2",
  principal_name: "Trần Bình",
  level: "comment",
  effective_level: "edit",
  active: true,
  granted_by: "me",
  granted_by_name: "Nguyễn An",
  granted_at: "2026-10-20T14:41:00Z",
  share_id: "s2",
  origin: "chat",
  revoke_target: { kind: "share", id: "s2" },
};

const link = {
  source: "link",
  principal_type: "link",
  principal_id: "l1",
  principal_name: null,
  level: "view",
  effective_level: "view",
  active: true,
  granted_by_name: "Nguyễn An",
  granted_at: "2026-10-20T14:40:00Z",
  revoke_target: { kind: "link", id: "l1" },
};

const gone = {
  ...share,
  principal_id: "u3",
  principal_name: "Lê Cũ",
  level: "edit",
  effective_level: "edit",
  active: false,
  origin: null,
  revoke_target: null,
};

function report() {
  return DocumentAccessReportSchema.parse({
    scope: { kind: "workspace", workspace_id: WS, folder_id: null, folder_title: null },
    documents: [
      {
        document: {
          id: "d1",
          title: "Đề xuất ngân sách Q4.docx",
          kind: "file",
          visibility: "restricted",
          path: [{ id: "f1", title: "Kế hoạch" }],
          acl_owner: { id: "me", name: "Nguyễn An" },
          live_link_count: 1,
          updated_at: "2026-10-01T03:00:00Z",
          access_changed_at: "2026-10-20T14:41:00Z",
          general_scope: { kind: "restricted", level: null },
          flags: ["public_link", "direct_manage"],
          my_level: "manage",
        },
        rows: [owner, share, link, gone],
      },
      {
        document: {
          id: "d2",
          title: "Theo dõi chi phí.xlsx",
          kind: "file",
          visibility: "workspace",
          path: [],
          acl_owner: { id: "u2", name: "Trần Bình" },
          live_link_count: 0,
          updated_at: "2026-09-05T03:00:00Z",
          general_scope: { kind: "workspace", level: "view" },
          flags: [],
        },
        rows: [{ ...owner, principal_id: "u2", principal_name: "Trần Bình" }, workspaceDefault],
      },
    ],
  }).documents;
}

function renderTable(over: Partial<React.ComponentProps<typeof AccessReportTable>> = {}) {
  const onSortChange = vi.fn();
  render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={viewer}>
        <AccessReportTable
          wsId={WS}
          documents={report()}
          sort="changed"
          order="desc"
          onSortChange={onSortChange}
          documentHref={(id) => `/acme/doi/documents/${id}`}
          {...over}
        />
      </WorkspaceProvider>,
      fakeNav("/acme/doi/documents/access-report"),
    ),
  );
  return { onSortChange };
}

const docRow = (title: string) => screen.getByText(title).closest("tr")!;

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  shared.targets.length = 0;
  resetAuthStoreForTests();
  setSessionUser(viewer);
});

describe("AccessReportTable", () => {
  it("draws one header row and exactly one row per document, without a Status column", () => {
    renderTable();
    const table = screen.getByRole("table", { name: at("title") });
    expect(within(table).getAllByRole("rowgroup")[0]!.querySelectorAll("tr")).toHaveLength(1);
    expect(table.querySelectorAll("tbody > tr")).toHaveLength(2);
    for (const col of ["col_general_scope", "col_people", "col_warnings"]) {
      expect(within(table).getByRole("columnheader", { name: at(col) })).toBeInTheDocument();
    }
    // The redesign dropped the Status column: no header by that visible text, in either language.
    expect(within(table).queryByRole("columnheader", { name: /^(status|trạng thái)$/i })).toBeNull();
    expect(within(table).getAllByRole("columnheader")).toHaveLength(6);
  });

  it("fixes the column widths and truncates a long name and path with the full text on hover", () => {
    const longTitle = `Báo cáo tài chính quý ba ${"rất dài ".repeat(15)}.docx`;
    renderTable({
      documents: DocumentAccessReportSchema.parse({
        scope: { kind: "workspace", workspace_id: WS },
        documents: [
          {
            document: {
              id: "d9",
              title: longTitle,
              kind: "file",
              path: [{ id: "f1", title: "Kế hoạch" }],
              acl_owner: { id: "me", name: "Nguyễn An" },
              my_level: "manage",
            },
            rows: [owner],
          },
        ],
      }).documents,
    });
    const table = screen.getByRole("table", { name: at("title") });
    // A fixed layout is what lets the Document column give way instead of growing the table.
    expect(table).toHaveClass("table-fixed");
    const name = screen.getByText(longTitle);
    expect(name).toHaveClass("truncate");
    expect(name).toHaveAttribute("title", longTitle);
    const where = at("path_owner", { path: "Kế hoạch", owner: "Nguyễn An" });
    expect(screen.getByText(where)).toHaveClass("truncate");
    expect(screen.getByText(where)).toHaveAttribute("title", where);
    // Every flex ancestor up to the cell may shrink below its content.
    expect(name.parentElement).toHaveClass("min-w-0");
    expect(name.closest("button")).toHaveClass("min-w-0");
    expect(name.closest("td")).toHaveClass("overflow-hidden");
  });

  it("starts the open grants at the left edge of the scroll box, whatever the box is scrolled to", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    const grants = screen.getByRole("table", { name: "Đề xuất ngân sách Q4.docx" });
    // The grants sit in a block pinned to the left that is never wider than the screen,
    // with its own box for the wide table inside it.
    const pinned = grants.closest("[data-grants-pin]");
    expect(pinned).not.toBeNull();
    expect(pinned).toHaveClass("sticky", "left-3");
    expect(grants.parentElement).toHaveClass("overflow-x-auto");
  });

  it("sizes the open grants to the scroll box, not the viewport, so the sidebar does not count", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    const pinned = screen.getByRole("table", { name: "Đề xuất ngân sách Q4.docx" }).closest("[data-grants-pin]")!;
    // cqw resolves against the nearest size container: the overflow box that scrolls.
    expect(pinned.className).not.toContain("vw");
    expect(pinned.className).toContain("100cqw");
    const box = screen.getByRole("table", { name: at("title") }).parentElement!;
    expect(box).toHaveClass("overflow-x-auto", "[container-type:inline-size]");
    expect(box.contains(pinned)).toBe(true);
  });

  it("gives the scope pill and the expand chevron the room they need", () => {
    renderTable();
    const heads = screen.getAllByRole("columnheader");
    // "Toàn tổ chức · Chỉnh sửa" stays inside its cell at the table's width floor.
    expect(heads[1]).toHaveClass("w-[16%]");
    expect(heads[2]).toHaveClass("w-[18%]");
    // The 44px coarse-pointer chevron fits: 64px column, 16px padding, 48px of room.
    const expand = heads.at(-1)!;
    expect(expand).toHaveClass("w-16", "px-2");
    const chevron = within(docRow("Đề xuất ngân sách Q4.docx")).getAllByRole("cell").at(-1)!;
    expect(chevron).toHaveClass("px-2");
  });

  it("shows the whole document name above the open grants, whatever the row cut short", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    const grants = screen.getByRole("table", { name: "Đề xuất ngân sách Q4.docx" });
    const heading = within(grants.closest("tr")!).getByText("Đề xuất ngân sách Q4.docx");
    expect(heading).toHaveClass("break-words");
    expect(heading).not.toHaveClass("truncate");
    expect(heading).toHaveAttribute("title", "Đề xuất ngân sách Q4.docx");
  });

  it("shows the path and owner, the general scope, who has access, the warnings and the last access change", () => {
    renderTable();
    const row = docRow("Đề xuất ngân sách Q4.docx");
    expect(within(row).getByText(at("path_owner", { path: "Kế hoạch", owner: "Nguyễn An" }))).toBeInTheDocument();
    expect(within(row).getByText(at("scope_private"))).toBeInTheDocument();
    // The inactive grant is not counted.
    expect(within(row).getByText(`${at("who_people", { count: 2 })} · ${at("who_links", { count: 1 })}`)).toBeInTheDocument();
    expect(within(row).getByText(at("flag_public_link"))).toBeInTheDocument();
    expect(within(row).getByText(at("flag_direct_manage"))).toBeInTheDocument();
    expect(within(row).getAllByRole("cell").at(-2)!.textContent).toBe(formatWhen("2026-10-20T14:41:00Z", i18n.language));

    const other = docRow("Theo dõi chi phí.xlsx");
    expect(within(other).getByText(at("scope_workspace_level", { level: at("level_view") }))).toBeInTheDocument();
    expect(within(other).getByText(`${at("who_workspace")} · ${at("who_people", { count: 1 })}`)).toBeInTheDocument();
    // No access_changed_at: the content's updated_at stands in.
    expect(within(other).getAllByRole("cell").at(-2)!.textContent).toBe(formatWhen("2026-09-05T03:00:00Z", i18n.language));
  });

  it("sorts on the server: the arrow on the sorted column, a click asks for the new order", () => {
    const { onSortChange } = renderTable();
    expect(screen.getByRole("columnheader", { name: new RegExp(at("col_changed")) })).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: at("sort_by", { column: at("col_document") }) }));
    expect(onSortChange).toHaveBeenCalledWith({ sort: "title", order: "asc" });
  });

  it("opens a row onto its grants: who, level, the effective note only when it differs, source, by, on", () => {
    renderTable();
    const toggle = screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: at("collapse", { name: "Đề xuất ngân sách Q4.docx" }) })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const grants = screen.getByRole("table", { name: "Đề xuất ngân sách Q4.docx" });
    const lines = within(grants).getAllByRole("row").slice(1);
    expect(lines).toHaveLength(4);

    const [ownerLine, shareLine, linkLine, goneLine] = lines as [HTMLElement, HTMLElement, HTMLElement, HTMLElement];
    expect(within(ownerLine).getByText(at("you"))).toBeInTheDocument();
    expect(within(ownerLine).getByText(at("source_acl_owner"))).toBeInTheDocument();
    expect(within(ownerLine).queryByText(at("effective_note", { level: at("level_manage") }))).toBeNull();

    expect(within(shareLine).getByText("Trần Bình")).toBeInTheDocument();
    expect(within(shareLine).getByText(at("level_comment"))).toBeInTheDocument();
    expect(within(shareLine).getByText(at("effective_note", { level: at("level_edit") }))).toBeInTheDocument();
    expect(within(shareLine).getByText(at("source_chat"))).toBeInTheDocument();
    expect(within(shareLine).getByText("Nguyễn An")).toBeInTheDocument();

    expect(within(linkLine).getByText(at("anyone_with_link"))).toBeInTheDocument();
    expect(within(linkLine).getByText(at("source_link"))).toBeInTheDocument();

    expect(within(goneLine).getByText(at("inactive"))).toBeInTheDocument();
    expect(within(goneLine).getByText(at("source_direct"))).toBeInTheDocument();
  });

  it("offers Revoke only on grants the server named a target for", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    const grants = screen.getByRole("table", { name: "Đề xuất ngân sách Q4.docx" });
    const [, ...lines] = within(grants).getAllByRole("row");
    // Owner and inactive grant carry no target; the share and the link do.
    expect(lines.map((line) => within(line).queryAllByRole("button").length)).toEqual([0, 1, 1, 0]);
  });

  it("names every Revoke button after its grantee, so a screen reader can tell them apart", () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    const grants = screen.getByRole("table", { name: "Đề xuất ngân sách Q4.docx" });
    expect(within(grants).getByRole("button", { name: at("revoke_label", { name: "Trần Bình" }) })).toBeInTheDocument();
    expect(within(grants).getByRole("button", { name: at("revoke_label", { name: at("anyone_with_link") }) })).toBeInTheDocument();
  });

  it("revokes after a confirmation, through the share route, and says so", async () => {
    requestMock.mockResolvedValue(undefined);
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    const shareLine = screen.getByText("Trần Bình").closest("tr")!;
    fireEvent.click(within(shareLine).getByRole("button", { name: at("revoke_label", { name: "Trần Bình" }) }));

    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByText(at("revoke_title", { name: "Trần Bình" }))).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole("button", { name: at("revoke") }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(at("revoke_done", { name: "Trần Bình" })));
    const [path, init] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/documents/d1/shares/s2");
    expect(init.method).toBe("DELETE");
    // Not optimistic: the grant stays until the report refetches.
    expect(screen.getByText("Trần Bình")).toBeInTheDocument();
  });

  it("revokes a link through the link route and reports a failure", async () => {
    requestMock.mockRejectedValue(new Error("boom"));
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    const linkLine = screen.getByText(at("anyone_with_link")).closest("tr")!;
    fireEvent.click(within(linkLine).getByRole("button", { name: at("revoke_label", { name: at("anyone_with_link") }) }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: at("revoke") }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(at("revoke_failed")));
    expect(requestMock.mock.calls[0]![0]).toBe("/api/v1/documents/d1/links/l1");
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("opens the document and the share dialog from the open row", async () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    expect(screen.getByRole("link", { name: at("open_document") })).toHaveAttribute("href", "/acme/doi/documents/d1");
    fireEvent.click(screen.getByRole("button", { name: at("manage_sharing") }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("revokes an emergency grant through the break-glass route", async () => {
    requestMock.mockResolvedValue({ status: "ok" });
    const breakGlass = {
      ...share,
      source: "break_glass",
      principal_id: "u9",
      principal_name: "Phạm Khẩn",
      share_id: undefined,
      origin: null,
      revoke_target: { kind: "break_glass", id: "g1" },
    };
    renderTable({
      documents: DocumentAccessReportSchema.parse({
        scope: { kind: "workspace", workspace_id: WS },
        documents: [{ document: { id: "d1", title: "Tài liệu khẩn", kind: "file", my_level: "manage" }, rows: [breakGlass] }],
      }).documents,
    });
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Tài liệu khẩn" }) }));
    fireEvent.click(screen.getByRole("button", { name: at("revoke_label", { name: "Phạm Khẩn" }) }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: at("revoke") }));

    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(at("revoke_done", { name: "Phạm Khẩn" })));
    const [path, init] = requestMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe("/api/v1/documents/d1/break-glass/g1");
    expect(init.method).toBe("DELETE");
  });

  it("opens the share dialog on the report's own target: its workspace and organization, no work-product owner, the viewer's level", async () => {
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Đề xuất ngân sách Q4.docx" }) }));
    fireEvent.click(screen.getByRole("button", { name: at("manage_sharing") }));
    await screen.findByRole("dialog");
    expect(shared.targets.at(-1)).toMatchObject({
      id: "d1",
      workspace_id: WS,
      organization_id: ORG,
      owner_kind: null,
      visibility: "restricted",
      my_level: "manage",
      admin_scope: false,
    });
  });

  it("keeps a pure admin an admin in the share dialog: no level of their own, admin scope on", async () => {
    renderTable({
      documents: DocumentAccessReportSchema.parse({
        scope: { kind: "workspace", workspace_id: WS },
        documents: [
          { document: { id: "d7", title: "Hồ sơ nội bộ", kind: "file", my_level: "", admin_scope: true }, rows: [owner] },
        ],
      }).documents,
    });
    fireEvent.click(screen.getByRole("button", { name: at("expand_document", { name: "Hồ sơ nội bộ" }) }));
    fireEvent.click(screen.getByRole("button", { name: at("manage_sharing") }));
    await screen.findByRole("dialog");
    expect(shared.targets.at(-1)).toMatchObject({ my_level: "", admin_scope: true });
  });
});

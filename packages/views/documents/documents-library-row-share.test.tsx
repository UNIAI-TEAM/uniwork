import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { DocumentSourceFile } from "@uniwork/core/documents/sources-schema";
import { LibraryRowView, type LibraryRowHandlers } from "./documents-library-row";
import { specLadder } from "./library-columns";
import { documentRow, sourceRow, type DocumentSummaryRow, type LibraryRow } from "./library-rows";

// UNI-2009: change access from a list row without opening the document. The
// row offers Share in its ⋯ menu and its context menu, and its Access cell is
// a button; the dialog itself is hosted once per list (use-library-row-dialogs).

const { t } = initI18n();

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});

const SCOPE_HOME = { users: 0, home_workspace: true, workspaces: 0, organization: false, public_link: false };

function doc(over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id: "d1",
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "file",
    title: "Kế hoạch Q4.docx",
    visibility: "workspace",
    revision: "1",
    current_version: 1,
    position: 0,
    my_level: "manage",
    via: "member",
    share_scope: SCOPE_HOME,
    created_by: "",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-09-28T03:00:00Z",
    size_bytes: 2500,
    ...over,
  };
}

const handlers = {
  onOpen: vi.fn(),
  onFolder: vi.fn(),
  onGoToSource: vi.fn(),
  onDownloadSource: vi.fn(),
  onSaveSource: vi.fn(),
  onShare: vi.fn(),
  isStarred: () => false,
  personName: () => "An",
} satisfies LibraryRowHandlers;

function renderRow(row: LibraryRow, over: Partial<LibraryRowHandlers> = {}) {
  return render(
    <table>
      <tbody>
        <LibraryRowView row={row} handlers={{ ...handlers, ...over }} ladder={specLadder("workspace", { selectable: false })} />
      </tbody>
    </table>,
  );
}

const rowEl = () => document.querySelector("[data-library-row]") as HTMLElement;
const accessCell = () => rowEl().querySelectorAll("td")[1]!;

const shareLabel = () => t("documents.actions.share");

async function openRowMenu(title: string) {
  fireEvent.click(within(rowEl()).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
  return screen.findByRole("menu");
}

async function openContextMenu() {
  fireEvent.contextMenu(rowEl());
  return screen.findByRole("menu");
}

/** A row with no command has no ⋯ button at all; either way no Share item may exist. */
async function expectNoShare(title: string) {
  const menuButton = within(rowEl()).queryByRole("button", { name: t("documents.home.row.menu", { title }) });
  if (menuButton) {
    fireEvent.click(menuButton);
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: shareLabel() })).toBeNull();
    fireEvent.keyDown(menu, { key: "Escape" });
  }
  fireEvent.contextMenu(rowEl());
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(screen.queryByRole("menuitem", { name: shareLabel() })).toBeNull();
}

const source: DocumentSourceFile = {
  id: "chat:m1",
  source: "chat",
  parent: { kind: "chat_channel", id: "c1", title: "general" },
  name: "Đề xuất.pdf",
  extension: "pdf",
  can_save: true,
} as DocumentSourceFile;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("Share in the row menus", () => {
  const shareable = doc();
  const cases: [string, DocumentSummaryRow][] = [
    ["a folder", doc({ id: "fo1", kind: "folder", title: "Dự án" })],
    ["My Folder", doc({ id: "mf", kind: "folder", title: "My Folder", system_kind: "my_folder" })],
    ["an owned (work-product) document", doc({ owner_kind: "task", owner_id: "t1" })],
    ["an archived document", doc({ archived_at: "2026-10-01T00:00:00Z" })],
  ];

  it("offers Share on a document in the ⋯ menu and the context menu, with the Share2 icon", async () => {
    const view = renderRow(documentRow(shareable));
    const menu = await openRowMenu(shareable.title);
    const item = within(menu).getByRole("menuitem", { name: shareLabel() });
    expect(item.querySelector("svg.lucide-share-2")).toBeTruthy();
    fireEvent.click(item);
    expect(handlers.onShare).toHaveBeenCalledWith(shareable);
    view.unmount();

    renderRow(documentRow(shareable));
    const context = await openContextMenu();
    fireEvent.click(within(context).getByRole("menuitem", { name: shareLabel() }));
    expect(handlers.onShare).toHaveBeenCalledTimes(2);
    expect(handlers.onShare).toHaveBeenLastCalledWith(shareable);
  });

  it("shows it to a reader who cannot manage (the dialog reads their own level)", async () => {
    renderRow(documentRow(doc({ my_level: "view" })));
    const menu = await openRowMenu("Kế hoạch Q4.docx");
    expect(within(menu).getByRole("menuitem", { name: shareLabel() })).toBeTruthy();
  });

  it.each(cases)("does not offer it on %s", async (_name, row) => {
    renderRow(documentRow(row));
    await expectNoShare(row.title);
  });

  it("does not offer it on a source row", async () => {
    renderRow(sourceRow(source));
    await expectNoShare(source.name);
  });

  it("offers nothing where the host wires no onShare", async () => {
    renderRow(documentRow(shareable), { onShare: undefined });
    await expectNoShare(shareable.title);
  });
});

describe("the Access cell as a button", () => {
  it("names 'Manage access for {title}' for a manager and opens Share without opening the row", () => {
    const row = doc();
    renderRow(documentRow(row));
    const button = within(accessCell()).getByRole("button", { name: (name) => name.startsWith(t("documents.home.access.manage_for", { title: row.title })) });
    // WCAG 2.5.3 label in name: the name leads with the command and carries
    // the visible scope and level text, so a voice user can say what they see.
    expect(button).toHaveAccessibleName("Quản lý quyền truy cập của Kế hoạch Q4.docx Workspace Bạn: Quản lý");
    // The scope badge and the viewer's level still read inside it.
    expect(within(button).getByText("Workspace")).toBeTruthy();
    expect(within(button).getByText("Bạn: Quản lý")).toBeTruthy();
    expect(button.className).toContain("pointer-coarse:min-h-11");
    expect(button.className).not.toContain("outline-none");

    fireEvent.click(button);
    expect(handlers.onShare).toHaveBeenCalledTimes(1);
    expect(handlers.onShare).toHaveBeenCalledWith(row);
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("names 'View access for {title}' for anyone who cannot manage", () => {
    const row = doc({ my_level: "edit", via: "share" });
    renderRow(documentRow(row));
    const button = within(accessCell()).getByRole("button", { name: (name) => name.startsWith(t("documents.home.access.view_for", { title: row.title })) });
    expect(button).toHaveAccessibleName("Xem quyền truy cập của Kế hoạch Q4.docx Workspace Bạn: Sửa");
    fireEvent.click(button);
    expect(handlers.onShare).toHaveBeenCalledWith(row);
  });

  it("opens from the keyboard with Enter and with Space", async () => {
    const user = userEvent.setup();
    renderRow(documentRow(doc()));
    const button = within(accessCell()).getByRole("button");
    button.focus();
    await user.keyboard("{Enter}");
    expect(handlers.onShare).toHaveBeenCalledTimes(1);
    await user.keyboard(" ");
    expect(handlers.onShare).toHaveBeenCalledTimes(2);
    expect(handlers.onOpen).not.toHaveBeenCalled();
  });

  it("is plain text on a folder, My Folder, an owned or an archived document, and without onShare", () => {
    for (const row of [
      doc({ kind: "folder", title: "Dự án" }),
      doc({ kind: "folder", title: "My Folder", system_kind: "my_folder" }),
      doc({ owner_kind: "task", owner_id: "t1" }),
      doc({ archived_at: "2026-10-01T00:00:00Z" }),
    ]) {
      const view = renderRow(documentRow(row));
      expect(within(accessCell()).queryByRole("button")).toBeNull();
      view.unmount();
    }
    renderRow(documentRow(doc()), { onShare: undefined });
    expect(within(accessCell()).queryByRole("button")).toBeNull();
  });

  it("keeps a source row's cell plain", () => {
    renderRow(sourceRow(source));
    expect(within(accessCell()).queryByRole("button")).toBeNull();
  });
});

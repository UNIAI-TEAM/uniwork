import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav, fakeNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";
import type { DocumentSummaryRow } from "./library-rows";
import { useLibraryRowDialogs } from "./use-library-row-dialogs";

// UNI-2009: the Share dialog behind a list row. One ShareDialog is mounted by
// useLibraryRowDialogs and every list host (home, folder, Recent, Starred,
// Shared with me, Shared by me) reaches it through the same handlers. The Lưu
// trữ (shelved) list renders its own ShelvedRowView and is not a host.

const { t } = initI18n();

const WS = "ws1";
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;
const TREE_URL = `${LIST_BASE}/tree`;
const SCOPE_HOME = { users: 0, home_workspace: true, workspaces: 0, organization: false, public_link: false };

function row(over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id: "d1",
    organization_id: "org1",
    workspace_id: WS,
    kind: "file",
    title: "Kế hoạch Q4.docx",
    visibility: "workspace",
    revision: "5",
    current_version: 1,
    position: 0,
    my_level: "manage",
    via: "member",
    share_scope: SCOPE_HOME,
    created_by: "u1",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    size_bytes: 2500,
    ...over,
  } as DocumentSummaryRow;
}

const workspace = { id: WS, slug: WS, organization_id: "org1", organization_slug: "acme", name: "Team" } as unknown as Workspace;
const user = { id: "u1", email: "an@example.com", display_name: "An" } as unknown as User;

function route(list: DocumentSummaryRow[], favorites: DocumentSummaryRow[] = list) {
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
    if (path.startsWith(`${LIST_BASE}/sources`)) return Promise.resolve({ items: [], next_cursor: null });
    if (path.startsWith("/api/v1/documents/") && path.includes("/shares")) {
      return Promise.resolve({ my_level: "manage", via: "member", shares: [] });
    }
    if (path.startsWith("/api/v1/documents/fo1")) {
      return Promise.resolve({ document: row({ id: "fo1", kind: "folder", title: "Dự án CCB", revision: "3", breadcrumbs: [] } as Partial<DocumentSummaryRow>) });
    }
    if (path.startsWith("/api/v1/orgs/") && path.includes("favorites")) {
      return Promise.resolve({ favorites: favorites.map((d) => ({ document_id: d.id, workspace_id: WS, title: d.title, kind: d.kind })) });
    }
    if (path.startsWith("/api/v1/orgs/")) return Promise.resolve({ members: [], workspaces: [] });
    if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: list, next_cursor: null });
    return Promise.resolve({});
  });
}

const sharesReads = () => requestMock.mock.calls.filter(([path]) => String(path) === "/api/v1/documents/d1/shares");

function Harness({ item }: { item: DocumentSummaryRow }) {
  const rowDialogs = useLibraryRowDialogs({ wsId: WS, tree: [], folderId: null });
  return (
    <>
      <button type="button" onClick={() => rowDialogs.onShare(item)}>
        cmd-share
      </button>
      {rowDialogs.dialogs}
    </>
  );
}

beforeEach(async () => {
  requestMock.mockReset();
  resetAuthStoreForTests();
  setSessionUser({
    id: "u1",
    email: "an@example.com",
    display_name: "An",
    onboarded_at: "2026-08-25T00:00:00Z",
    email_verified_at: "2026-08-25T00:00:00Z",
    onboarding_questionnaire: {},
    locale: "vi",
  });
  await setLocale("vi");
});

describe("onShare", () => {
  it("mounts the one ShareDialog on the row's document and closes it again", async () => {
    route([]);
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <Harness item={row()} />
        </WorkspaceProvider>,
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    // Nothing is read until the dialog is open.
    expect(sharesReads()).toHaveLength(0);

    fireEvent.click(screen.getByText("cmd-share"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: t("documents.share.title_named", { title: "Kế hoạch Q4.docx" }) })).toBeInTheDocument();
    await waitFor(() => expect(sharesReads()).toHaveLength(1));

    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("never opens for a folder, My Folder or an owned document, whatever the caller passes", () => {
    route([]);
    for (const item of [
      row({ kind: "folder", title: "Dự án" }),
      row({ kind: "folder", title: "My Folder", system_kind: "my_folder" }),
      row({ owner_kind: "task", owner_id: "t1" }),
    ]) {
      const view = render(
        wrapWithNav(
          <WorkspaceProvider workspace={workspace} user={user}>
            <Harness item={item} />
          </WorkspaceProvider>,
        ),
      );
      fireEvent.click(screen.getByText("cmd-share"));
      expect(screen.queryByRole("dialog")).toBeNull();
      view.unmount();
    }
  });
});

const VIEWS: [string, string][] = [
  ["the documents home", "/acme/ws1/documents"],
  ["a folder page", "/acme/ws1/documents?folder=fo1"],
  ["Recent", "/acme/ws1/documents?view=recent"],
  ["Shared with me", "/acme/ws1/documents?view=shared"],
  ["Starred", "/acme/ws1/documents?view=starred"],
  ["Shared by me", "/acme/ws1/documents?view=shared-by-me"],
];

describe("every list host wires the Access cell and the row menu to the dialog", () => {
  it.each(VIEWS)("%s", async (_name, url) => {
    route([row()]);
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    const onOpen = vi.fn();
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={onOpen} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>,
        fakeNav(url),
      ),
    );

    const tr = await waitFor(() => {
      const found = document.querySelector('[data-library-row="d1"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });

    // The Access cell is a button: it opens the dialog and the row stays shut.
    fireEvent.click(within(tr).getByRole("button", { name: (name) => name.startsWith(t("documents.home.access.manage_for", { title: "Kế hoạch Q4.docx" })) }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("heading", { name: t("documents.share.title_named", { title: "Kế hoạch Q4.docx" }) })).toBeInTheDocument();
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // So does Share in the ⋯ menu.
    fireEvent.click(within(tr).getByRole("button", { name: t("documents.home.row.menu", { title: "Kế hoạch Q4.docx" }) }));
    fireEvent.click(await screen.findByRole("menuitem", { name: t("documents.actions.share") }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

// The Starred view builds its rows from the favorites plus a loaded copy of the
// same document (favoriteRow); the Share gate must read that copy's owner, not
// a default, so a starred work-product document offers what its own list does.
describe("the Starred view keeps the Share gate of the document's own row", () => {
  async function renderStarred(list: DocumentSummaryRow[], favorites: DocumentSummaryRow[]) {
    route(list, favorites);
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>,
        fakeNav("/acme/ws1/documents?view=starred"),
      ),
    );
    return waitFor(() => {
      const found = document.querySelector('[data-library-row="d1"]');
      expect(found).not.toBeNull();
      return found as HTMLElement;
    });
  }

  const title = "Kế hoạch Q4.docx";
  const accessButtons = (tr: HTMLElement) =>
    within(tr).queryAllByRole("button", { name: new RegExp(`${t("documents.home.access.manage_for", { title })}|${t("documents.home.access.view_for", { title })}`) });

  async function shareItem(tr: HTMLElement) {
    fireEvent.click(within(tr).getByRole("button", { name: t("documents.home.row.menu", { title }) }));
    const menu = await screen.findByRole("menu");
    return within(menu).queryByRole("menuitem", { name: t("documents.actions.share") });
  }

  it("offers neither Share nor the Access button on a starred owned (work-product) document", async () => {
    const owned = row({ owner_kind: "task", owner_id: "t1" });
    const tr = await renderStarred([owned], [owned]);
    expect(accessButtons(tr)).toHaveLength(0);
    expect(await shareItem(tr)).toBeNull();
  });

  it("offers neither on a starred document whose copy has not loaded", async () => {
    const tr = await renderStarred([], [row()]);
    expect(accessButtons(tr)).toHaveLength(0);
    expect(await shareItem(tr)).toBeNull();
  });

  it("names Manage access for a starred document the viewer administers through admin_scope", async () => {
    const admin = row({ my_level: undefined, admin_scope: true });
    const tr = await renderStarred([admin], [admin]);
    expect(within(tr).getByRole("button", { name: new RegExp(t("documents.home.access.manage_for", { title })) })).toBeInTheDocument();
    expect(await shareItem(tr)).not.toBeNull();
  });
});

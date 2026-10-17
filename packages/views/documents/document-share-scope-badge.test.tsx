import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import type { DocumentShareScope, DocumentSummary, DocumentTreeNode } from "@uniwork/core/types/document";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentShareScopeBadge, resolveDocumentShareScope } from "./document-share-scope-badge";
import { DocumentTree } from "./document-tree";
import { DocumentsLibraryList } from "./documents-library-list";
import { type LibraryRowHandlers } from "./documents-library-row";
import { DocumentsSearchResults } from "./documents-search-results";
import { documentRow } from "./library-rows";

initI18n();

beforeAll(async () => {
  await setLocale("vi");
});
afterAll(async () => {
  await setLocale("en");
});
beforeEach(() => {
  requestMock.mockReset();
});

const workspace: Workspace = {
  id: "ws1",
  slug: "san-pham",
  name: "Sản phẩm",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

const user: User = {
  id: "u1",
  email: "an@example.com",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

function scope(over: Partial<DocumentShareScope> = {}): DocumentShareScope {
  return {
    users: 0,
    home_workspace: false,
    workspaces: 0,
    organization: false,
    public_link: false,
    ...over,
  };
}

describe("DocumentShareScopeBadge (UNI-1785)", () => {
  it("renders 'Riêng tư' with a lock icon when not shared with anyone and no public link", () => {
    render(<DocumentShareScopeBadge shareScope={scope()} />);

    const badge = screen.getByTestId("document-share-scope-badge");
    expect(within(badge).getByText("Riêng tư")).toBeInTheDocument();
    expect(badge.querySelector('[data-scope-icon="private"]')).toBeTruthy();
    expect(badge.querySelector('[data-scope-icon="public-link"]')).toBeNull();

    const descId = badge.getAttribute("aria-describedby");
    expect(descId).toBeTruthy();
    expect(document.getElementById(descId!)?.textContent).toBe("Riêng tư");
  });

  it("renders '{{count}} người' with a users icon when shared with people only", () => {
    render(<DocumentShareScopeBadge shareScope={scope({ users: 3 })} />);

    const badge = screen.getByTestId("document-share-scope-badge");
    expect(within(badge).getByText("3 người")).toBeInTheDocument();
    expect(badge.querySelector('[data-scope-icon="people"]')).toBeTruthy();

    const descId = badge.getAttribute("aria-describedby")!;
    expect(document.getElementById(descId)?.textContent).toBe("3 người");
  });

  it("renders 'Workspace' with a workspace icon when shared with the home workspace only", () => {
    render(
      <WorkspaceProvider workspace={workspace} user={user}>
        <DocumentShareScopeBadge shareScope={scope({ home_workspace: true })} />
      </WorkspaceProvider>,
    );

    const badge = screen.getByTestId("document-share-scope-badge");
    expect(within(badge).getByText("Workspace")).toBeInTheDocument();
    expect(badge.querySelector('[data-scope-icon="workspace"]')).toBeTruthy();

    const descId = badge.getAttribute("aria-describedby")!;
    expect(document.getElementById(descId)?.textContent).toBe("Workspace Sản phẩm");
  });

  it("renders '{{count}} workspace' when shared with other workspaces only", () => {
    render(<DocumentShareScopeBadge shareScope={scope({ workspaces: 2 })} />);

    const badge = screen.getByTestId("document-share-scope-badge");
    expect(within(badge).getByText("2 workspace")).toBeInTheDocument();
    expect(badge.querySelector('[data-scope-icon="workspaces"]')).toBeTruthy();

    const descId = badge.getAttribute("aria-describedby")!;
    expect(document.getElementById(descId)?.textContent).toBe("2 workspace khác");
  });

  it("renders 'Tổ chức' with a building icon when shared with the organization only", () => {
    render(<DocumentShareScopeBadge shareScope={scope({ organization: true })} />);

    const badge = screen.getByTestId("document-share-scope-badge");
    expect(within(badge).getByText("Tổ chức")).toBeInTheDocument();
    expect(badge.querySelector('[data-scope-icon="organization"]')).toBeTruthy();

    const descId = badge.getAttribute("aria-describedby")!;
    expect(document.getElementById(descId)?.textContent).toBe("Tổ chức");
  });

  it("renders 'Nhiều phạm vi' with a share-nodes icon and full tooltip/aria-describedby when two or more scopes combine", () => {
    render(
      <WorkspaceProvider workspace={workspace} user={user}>
        <DocumentShareScopeBadge
          shareScope={scope({
            home_workspace: true,
            workspaces: 1,
            users: 5,
            public_link: true,
          })}
        />
      </WorkspaceProvider>,
    );

    const badge = screen.getByTestId("document-share-scope-badge");
    expect(within(badge).getByText("Nhiều phạm vi")).toBeInTheDocument();
    expect(badge.querySelector('[data-scope-icon="multiple"]')).toBeTruthy();
    expect(badge.querySelector('[data-scope-icon="public-link"]')).toBeTruthy();

    const expectedTooltip = "Workspace Sản phẩm · 1 workspace khác · 5 người · Liên kết công khai";
    expect(badge).toHaveAttribute("title", expectedTooltip);
    const descId = badge.getAttribute("aria-describedby")!;
    expect(document.getElementById(descId)?.textContent).toBe(expectedTooltip);

    fireEvent.focus(badge);
    expect(screen.getByRole("tooltip")).toHaveTextContent(expectedTooltip);
  });

  it("appends the public link icon mark and 'Liên kết công khai' to any single state when public_link is true", () => {
    render(<DocumentShareScopeBadge shareScope={scope({ public_link: true })} />);

    const badge = screen.getByTestId("document-share-scope-badge");
    expect(within(badge).getByText("Riêng tư")).toBeInTheDocument();
    expect(badge.querySelector('[data-scope-icon="private"]')).toBeTruthy();
    expect(badge.querySelector('[data-scope-icon="public-link"]')).toBeTruthy();

    const descId = badge.getAttribute("aria-describedby")!;
    expect(document.getElementById(descId)?.textContent).toBe("Riêng tư · Liên kết công khai");
  });

  it("falls back to visibility when share_scope is absent and renders nothing when both are unknown", () => {
    expect(resolveDocumentShareScope(null, "restricted")).toEqual(scope());
    expect(resolveDocumentShareScope(undefined, "workspace")).toEqual(scope({ home_workspace: true }));
    expect(resolveDocumentShareScope(undefined, undefined)).toBeNull();

    const { rerender, container } = render(<DocumentShareScopeBadge visibility="restricted" />);
    expect(screen.getByText("Riêng tư")).toBeInTheDocument();

    rerender(<DocumentShareScopeBadge visibility="workspace" />);
    expect(screen.getByText("Workspace")).toBeInTheDocument();

    rerender(<DocumentShareScopeBadge />);
    expect(container.firstChild).toBeNull();
  });

  it("mounts in library rows, tree rows, and search results", async () => {
    const handlers: LibraryRowHandlers = {
      onOpen: vi.fn(),
      onFolder: vi.fn(),
      onGoToSource: vi.fn(),
      onDownloadSource: vi.fn(),
      onSaveSource: vi.fn(),
      isStarred: () => false,
      personName: () => "An",
    };
    const summaryRow: DocumentSummary = {
      id: "d1",
      organization_id: "org1",
      workspace_id: "ws1",
      kind: "file",
      title: "Báo cáo Q4.docx",
      visibility: "restricted",
      share_scope: scope({ users: 4, public_link: true }),
      revision: "1",
      current_version: 1,
      position: 0,
      my_level: "edit",
      created_by: "",
      created_by_kind: "human",
      updated_by: "",
      updated_by_kind: "human",
      created_at: "",
      updated_at: "2026-10-15T03:00:00Z",
    };

    const { unmount } = render(
      <DocumentsLibraryList
        groups={[{ key: "unfiled", title: "", rows: [documentRow(summaryRow)] }]}
        loading={false}
        failure={null}
        filteredBy={null}
        hasMore={false}
        loadingMore={false}
        onLoadMore={vi.fn()}
        onRetry={vi.fn()}
        onClearFilters={vi.fn()}
        handlers={handlers}
        empty={{ title: "empty", description: "empty" }}
      />,
    );
    const libRow = document.querySelector('[data-library-row="d1"]') as HTMLElement;
    expect(within(libRow).getAllByText("4 người")).toHaveLength(2);
    unmount();

    // Search results mount
    render(
      <DocumentsSearchResults
        search={{
          query: "bao cao",
          committedQuery: "bao cao",
          filter: "all",
          active: true,
          composing: false,
          items: [
            {
              ...summaryRow,
              share_scope: scope({ organization: true }),
            },
          ],
          loading: false,
          loadingMore: false,
          hasMore: false,
          error: null,
          isError: false,
          setFilter: vi.fn(),
          onQueryChange: vi.fn(),
          onCompositionStart: vi.fn(),
          onCompositionEnd: vi.fn(),
          onKeyDown: vi.fn(),
          clear: vi.fn(),
          loadMore: vi.fn(),
          retry: vi.fn(),
        }}
        onSelectFolder={vi.fn()}
        onSelectDocument={vi.fn()}
      />,
    );
    expect(screen.getByText("Tổ chức")).toBeInTheDocument();
    unmount();

    // Tree rows mount
    const treeNodes: DocumentTreeNode[] = [
      {
        id: "t1",
        title: "Thư mục Chung",
        kind: "folder",
        position: 0,
        share_scope: scope({ home_workspace: true, users: 2 }),
        children: [],
      },
    ];
    requestMock.mockResolvedValue({ documents: treeNodes });
    render(wrap(<DocumentTree wsId="ws1" />));
    const treeItem = await screen.findByRole("treeitem", { name: /Thư mục Chung/ });
    expect(within(treeItem).getByText("Nhiều phạm vi")).toBeInTheDocument();
  });
});

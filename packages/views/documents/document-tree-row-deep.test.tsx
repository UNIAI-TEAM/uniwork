import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentTree } from "./document-tree";

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LONG_NAME = "Hợp đồng khung năm 2026 với nhà cung cấp";
const DOC_TITLE = `Biên bản ${LONG_NAME}`;

vi.mock("@dnd-kit/core", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@dnd-kit/core")>();
  return {
    ...actual,
    useDraggable: () => ({ attributes: {}, listeners: {}, setNodeRef: () => {}, isDragging: false }),
    useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
  };
});

const workspace: Workspace = {
  id: WS,
  slug: "doi",
  name: "Đội",
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};
const user = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;

// A chain of folders, depth 0..6, each named after its depth plus a long tail;
// a shared document sits beside the depth-4 folder (so at depth 4).
function chain(): DocumentTreeNode[] {
  const doc = {
    id: "doc4",
    title: DOC_TITLE,
    kind: "page",
    position: 1,
    share_scope: { home_workspace: false, users: 2, workspaces: 0, organization: false, public_link: false },
    children: [],
  } as DocumentTreeNode;
  let child: DocumentTreeNode[] = [];
  for (let d = 6; d >= 0; d -= 1) {
    child = [
      {
        id: `d${d}`,
        title: `Cấp ${d} ${LONG_NAME}`,
        kind: "folder",
        position: 0,
        children: d === 3 ? [...child, doc] : child,
      } as DocumentTreeNode,
    ];
  }
  return child;
}

async function renderExpandedChain() {
  requestMock.mockImplementation((path: string) => {
    if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: chain() });
    if (path === "/api/v1/orgs/org1/documents/favorites") {
      return Promise.resolve({
        favorites: [{ document_id: "d5", workspace_id: WS, title: "Cấp 5", kind: "folder" }],
      });
    }
    return Promise.resolve({});
  });
  render(
    wrap(
      <WorkspaceProvider workspace={workspace} user={user}>
        <DocumentTree wsId={WS} />
      </WorkspaceProvider>,
    ),
  );
  for (let d = 0; d < 6; d += 1) {
    fireEvent.click(
      await screen.findByRole("button", {
        name: t("documents.tree.expand", { title: `Cấp ${d} ${LONG_NAME}` }),
      }),
    );
  }
  return {
    rowAt: (d: number) => screen.getByRole("treeitem", { name: new RegExp(`Cấp ${d} `) }),
    docRow: () => screen.getByRole("treeitem", { name: new RegExp(DOC_TITLE) }),
  };
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("DocumentTree deep rows", () => {
  it("keeps the menu in the flex row above the overlay depth and over the row's right end from depth 2", async () => {
    const { rowAt } = await renderExpandedChain();

    for (const d of [0, 1]) {
      const row = rowAt(d);
      const menu = within(row).getByRole("button", { name: new RegExp(`^${t("documents.home.row.menu", { title: "Cấp" })}`) });
      expect(menu.parentElement).toBe(row);
      expect(row.querySelector("[data-row-trailing]")).toBeNull();
    }

    for (const d of [2, 3, 4, 5, 6]) {
      const row = rowAt(d);
      const trailing = row.querySelector("[data-row-trailing]");
      expect(trailing).not.toBeNull();
      expect(trailing?.parentElement).toBe(row);
      // Out of the flex row: absolutely positioned and invisible until hover, focus or an open menu.
      expect(trailing).toHaveClass("absolute", "right-0", "opacity-0", "pointer-events-none", "group-hover/row:opacity-100");
      // It holds the menu button and nothing else, and paints no background of its own, so it blends into every row state.
      expect(trailing?.children).toHaveLength(1);
      expect(trailing?.querySelector("[data-row-menu]")).not.toBeNull();
      expect(trailing?.className).not.toMatch(/\bbg-/);
      // The name keeps the whole row between the chevron/icon and the right padding.
      const name = within(row).getByText(`Cấp ${d} ${LONG_NAME}`);
      expect(name).toHaveClass("min-w-0", "flex-1", "truncate");
      expect(trailing?.contains(name)).toBe(false);
      expect(row).toHaveClass("pr-1");
    }
  });

  it("keeps the starred state in the row flow at rest on a deep row, away from the overlay", async () => {
    const { rowAt } = await renderExpandedChain();
    const row = rowAt(5);
    const trailing = row.querySelector("[data-row-trailing]");
    const star = await within(row).findByRole("img", { name: t("documents.home.row.starred") });

    // In the row, not in the overlay, and not hidden at rest: it only fades out under the revealed button.
    expect(star.parentElement).toBe(row);
    expect(trailing).not.toContainElement(star as HTMLElement);
    expect(star).not.toHaveClass("opacity-0", "absolute");
    expect(star).toHaveClass("pointer-fine:group-hover/row:opacity-0");

    // A shallow starred row is untouched by the overlay depth.
    expect(within(rowAt(0)).queryByRole("img", { name: t("documents.home.row.starred") })).toBeNull();
  });

  it("keeps the share-scope badge of a deep document in the row flow at rest, as an icon with its label for screen readers", async () => {
    const { docRow } = await renderExpandedChain();
    const row = docRow();
    const badge = within(row).getByTestId("document-share-scope-badge");

    expect(badge.parentElement).toBe(row);
    expect(row.querySelector("[data-row-trailing]")).not.toContainElement(badge);
    expect(badge).not.toHaveClass("opacity-0");
    expect(badge.querySelector("[data-scope-icon]")).not.toBeNull();
    // The label stays in the DOM (accessible name) but takes no width.
    expect(badge).toHaveClass("[&>span]:sr-only");
    expect(badge).toHaveTextContent(t("documents.scope.people", { count: 2 }));
  });

  it("keeps the full name in title and the menu reachable by accessible name, and reveals the overlay on roving focus", async () => {
    const { rowAt } = await renderExpandedChain();
    const row = rowAt(5);
    const full = `Cấp 5 ${LONG_NAME}`;

    expect(within(row).getByText(full)).toHaveAttribute("title", full);
    const trailing = row.querySelector("[data-row-trailing]");
    expect(
      await within(row).findByRole("button", { name: t("documents.home.row.menu", { title: full }) }),
    ).toBeInTheDocument();

    expect(trailing).not.toHaveClass("opacity-100");
    fireEvent.focus(row);
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(trailing).toHaveClass("opacity-100", "pointer-events-auto");
  });

  it("fades only as much of the name as the revealed menu covers, given the star and badge slots", async () => {
    const { rowAt, docRow } = await renderExpandedChain();
    const maskOf = (row: HTMLElement, text: string) =>
      within(row).getByText(text).style.getPropertyValue("--tree-name-mask");

    // Unstarred folder: the 24px the button reaches into the name. Starred: 24 - 18 (star slot). Starred + badge: none.
    expect(maskOf(rowAt(3), `Cấp 3 ${LONG_NAME}`)).toMatch(/^linear-gradient\(to left, transparent 24px, black 32px\)$/);
    expect(maskOf(rowAt(5), `Cấp 5 ${LONG_NAME}`)).toMatch(/^linear-gradient\(to left, transparent 6px, black 14px\)$/);
    // Unstarred document with a badge: 24 - 16.
    expect(maskOf(docRow(), DOC_TITLE)).toMatch(/^linear-gradient\(to left, transparent 8px, black 16px\)$/);
    // Shallow rows keep their menu in the row and carry no fade.
    expect(within(rowAt(1)).getByText(`Cấp 1 ${LONG_NAME}`).style.getPropertyValue("--tree-name-mask")).toBe("");
  });

  it("opens the row menu on Shift+F10 on a deep row and keeps the overlay revealed while it is open", async () => {
    const { rowAt } = await renderExpandedChain();
    const row = rowAt(3);
    const full = `Cấp 3 ${LONG_NAME}`;
    const trailing = row.querySelector("[data-row-trailing]");
    const menu = await within(row).findByRole("button", { name: t("documents.home.row.menu", { title: full }) });

    expect(menu).toHaveAttribute("aria-expanded", "false");
    fireEvent.keyDown(row, { key: "F10", shiftKey: true });

    expect(menu).toHaveAttribute("aria-expanded", "true");
    expect(trailing).toHaveClass("opacity-100", "pointer-events-auto");
  });
});

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

// A chain of folders, depth 0..6, each named after its depth plus a long tail.
function chain(): DocumentTreeNode[] {
  let child: DocumentTreeNode[] = [];
  for (let d = 6; d >= 0; d -= 1) {
    child = [
      {
        id: `d${d}`,
        title: `Cấp ${d} ${LONG_NAME}`,
        kind: "folder",
        position: 0,
        children: child,
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
        <DocumentTree wsId={WS} folders />
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
  return (d: number) => screen.getByRole("treeitem", { name: new RegExp(`Cấp ${d} `) });
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("DocumentTree deep rows", () => {
  it("keeps the trailing slots in the flex row above the overlay depth and out of it from depth 2", async () => {
    const rowAt = await renderExpandedChain();

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
      expect(trailing).toHaveClass("absolute", "opacity-0", "pointer-events-none", "group-hover/row:opacity-100");
      // The name keeps the whole row between the chevron/icon and the right padding.
      const name = within(row).getByText(`Cấp ${d} ${LONG_NAME}`);
      expect(name).toHaveClass("min-w-0", "flex-1", "truncate");
      expect(trailing?.contains(name)).toBe(false);
      expect(row).toHaveClass("pr-1");
    }
  });

  it("keeps the full name in title and the menu and star reachable by accessible name on a deep row", async () => {
    const rowAt = await renderExpandedChain();
    const row = rowAt(5);
    const full = `Cấp 5 ${LONG_NAME}`;

    expect(within(row).getByText(full)).toHaveAttribute("title", full);
    const trailing = row.querySelector("[data-row-trailing]");
    expect(
      await within(row).findByRole("button", { name: t("documents.home.row.menu", { title: full }) }),
    ).toBeInTheDocument();
    expect(trailing).toContainElement(
      await within(row).findByRole("img", { name: t("documents.home.row.starred") }),
    );

    // The roving-focus row shows its slots without a hover.
    expect(trailing).not.toHaveClass("opacity-100");
    fireEvent.focus(row);
    expect(row).toHaveAttribute("aria-selected", "true");
    expect(trailing).toHaveClass("opacity-100", "pointer-events-auto");
  });
  it("opens the row menu on Shift+F10 on a deep row and keeps the overlay revealed while it is open", async () => {
    const rowAt = await renderExpandedChain();
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

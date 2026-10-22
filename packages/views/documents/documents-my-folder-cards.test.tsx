import { act, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { DocumentTreeNode } from "@uniwork/core/types/document";
import { DocumentsFoldersGrid } from "./documents-folders-grid";
import { continueCards, RecentContinue } from "./documents-recent-continue";
import { documentRow, type DocumentSummaryRow } from "./library-rows";

// FX6 N3: the system My Folder is stored as "My Folder" and shown by the localized label everywhere
// (rows, tree, picker); the Mở tiếp card of Gần đây and the folder card of Home read it the same way.

const i18n = initI18n();

function folder(over: Partial<DocumentSummaryRow> = {}): DocumentSummaryRow {
  return {
    id: "mf1",
    organization_id: "org1",
    workspace_id: "ws1",
    kind: "folder",
    title: "My Folder",
    system_kind: "my_folder",
    visibility: "restricted",
    revision: "1",
    current_version: 0,
    position: 0,
    my_level: "manage",
    created_by: "u1",
    created_by_kind: "human",
    updated_by: "u1",
    updated_by_kind: "human",
    created_at: "",
    updated_at: "2026-10-20T03:00:00Z",
    last_activity: { kind: "edited", at: "2026-10-20T03:00:00Z" },
    ...over,
  } as DocumentSummaryRow;
}

async function inLanguage(lang: "vi" | "en", run: () => void) {
  await act(async () => {
    await i18n.changeLanguage(lang);
  });
  try {
    run();
  } finally {
    await act(async () => {
      await i18n.changeLanguage("vi");
    });
  }
}

const LABEL = { vi: "Thư mục của tôi", en: "My Folder" } as const;

describe("Mở tiếp card of Gần đây", () => {
  afterEach(() => document.body.replaceChildren());

  it.each(["vi", "en"] as const)("names My Folder by the localized label in %s", async (lang) => {
    await inLanguage(lang, () => {
      const cards = continueCards([documentRow(folder()), documentRow(folder({ id: "f2", title: "Dự án CCB", system_kind: null }))]);
      render(<RecentContinue cards={cards} onOpen={vi.fn()} />);
      const mine = document.querySelector('[data-document-id="mf1"]') as HTMLElement;
      expect(within(mine).getByText(LABEL[lang])).toBeInTheDocument();
      // Another folder keeps its own title.
      expect(within(document.querySelector('[data-document-id="f2"]') as HTMLElement).getByText("Dự án CCB")).toBeInTheDocument();
      if (lang === "vi") expect(screen.queryByText("My Folder")).toBeNull();
    });
  });
});

describe("folder card of Home", () => {
  afterEach(() => document.body.replaceChildren());

  const node = (over: Partial<DocumentTreeNode> = {}): DocumentTreeNode => ({ id: "mf1", title: "My Folder", kind: "folder", position: 0, children: [], ...over });
  const handlers = { isStarred: () => false, personName: () => null };

  it.each(["vi", "en"] as const)("names My Folder by the localized label in %s, whether the tree node or the loaded row carries the flag", async (lang) => {
    await inLanguage(lang, () => {
      const { unmount } = render(
        <DocumentsFoldersGrid folders={[node({ system_kind: "my_folder" })]} docById={new Map()} handlers={handlers} onOpenFolder={vi.fn()} />,
      );
      expect(screen.getByText(LABEL[lang])).toBeInTheDocument();
      unmount();
      render(
        <DocumentsFoldersGrid folders={[node()]} docById={new Map([["mf1", folder()]])} handlers={handlers} onOpenFolder={vi.fn()} />,
      );
      expect(screen.getByText(LABEL[lang])).toBeInTheDocument();
    });
  });
});

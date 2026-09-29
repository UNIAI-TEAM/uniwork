import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentActionsMenu } from "./document-actions-menu";

const { t } = initI18n();
const WS = "ws1";
const ORG = "o1";

const user: User = {
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: WS,
  slug: "team",
  name: "Team",
  organization_id: ORG,
  organization_slug: "acme",
  organization_name: "Acme",
};

function narrowDocument(parsed: ReturnType<typeof DocumentSchema.parse>): Document {
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
  };
}

function documentFixture(over: Record<string, unknown> = {}): Document {
  return narrowDocument(
    DocumentSchema.parse({
      id: "d1",
      workspace_id: WS,
      organization_id: ORG,
      kind: "file",
      title: "Báo cáo Q4",
      revision: "3",
      current_version: 1,
      my_level: "manage",
      file: {
        file_id: "f1",
        version_id: "v1",
        version: 1,
        filename: "bao-cao.pdf",
        mime_type: "application/pdf",
        size_bytes: 1024,
        checksum_sha256: "a".repeat(64),
      },
      ...over,
    }),
  );
}

function renderMenu(doc = documentFixture(), over: { onArchived?: () => void } = {}) {
  return render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <DocumentActionsMenu wsId={WS} doc={doc} onArchived={over.onArchived} />
      </WorkspaceProvider>,
    ),
  );
}

async function openMenu() {
  fireEvent.click(screen.getByRole("button", { name: t("documents.actions.menu_label") }));
  await screen.findByRole("menuitem", { name: t("documents.actions.versions") });
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(() => Promise.resolve({}));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("DocumentActionsMenu", () => {
  it("offers every manage/edit surface on a live file document", async () => {
    renderMenu();
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.share") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.access_log") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.copy") })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: t("documents.actions.archive") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.restore") })).toBeNull();
  });

  it("hides share, links, archive and copy on an owned document", async () => {
    renderMenu(documentFixture({ owner_kind: "work_product", owner_id: "wp1" }));
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.versions") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.share") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.copy") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.archive") })).toBeNull();
  });

  it("keeps a viewer to the read surfaces", async () => {
    renderMenu(documentFixture({ my_level: "view" }));
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.versions") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.share") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.archive") })).toBeNull();
  });

  it("offers restore instead of archive in the trash", async () => {
    renderMenu(documentFixture({ archived_at: "2026-09-27T03:00:00Z" }));
    await openMenu();

    expect(screen.getByRole("menuitem", { name: t("documents.actions.restore") })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.archive") })).toBeNull();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.share") })).toBeNull();
  });

  it("opens the version history sheet", async () => {
    renderMenu(documentFixture({ kind: "page" }));
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.versions") }));
    expect(await screen.findByText(t("documents.versions.title"))).toBeInTheDocument();
  });

  it("opens the archive dialog with its impact read", async () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith("/api/v1/workspaces/ws1/documents/tree")
        ? Promise.resolve({ documents: [] })
        : Promise.resolve({}),
    );
    renderMenu();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.archive") }));
    expect(await screen.findByText(t("documents.archive.archive_title"))).toBeInTheDocument();
  });

  it("drops the copy entry once the deployment answers 404", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1/copies" && opts?.method === "POST") {
        return Promise.reject(new ApiError("missing", "not_found", 404));
      }
      return Promise.resolve({});
    });
    renderMenu();
    await openMenu();

    fireEvent.click(screen.getByRole("menuitem", { name: t("documents.actions.copy") }));
    fireEvent.click(await screen.findByRole("checkbox", { name: t("documents.copy.consent_label") }));
    fireEvent.click(screen.getByRole("button", { name: t("documents.copy.submit") }));
    expect(await screen.findByRole("alert")).toHaveTextContent(t("documents.copy.unavailable"));

    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    await waitFor(() => expect(screen.queryByText(t("documents.copy.title"))).toBeNull());

    await openMenu();
    expect(screen.queryByRole("menuitem", { name: t("documents.actions.copy") })).toBeNull();
  });
});

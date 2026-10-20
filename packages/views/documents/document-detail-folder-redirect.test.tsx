import { QueryClient } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { ApiError } from "@uniwork/core/api/http";
import { documentKeys } from "@uniwork/core/documents/keys";
import { initI18n } from "@uniwork/core/i18n";
import { paths } from "@uniwork/core/paths";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentDetailView } from "./document-detail-view";

const { t } = initI18n();

const WS = "ws1";
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
  organization_id: "org1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function folderBody(id: string) {
  return {
    document: {
      id,
      workspace_id: WS,
      organization_id: "org1",
      kind: "folder",
      title: "Hợp đồng",
      revision: "1",
      current_version: 0,
      my_level: "manage",
      created_at: "2026-09-28T03:00:00Z",
      updated_at: "2026-09-28T03:00:00Z",
    },
  };
}

function renderFolder(nav: ReturnType<typeof fakeNav>) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  return render(
    wrapWithNav(
      <FeatureFlagsProvider service={service}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <DocumentDetailView wsId={WS} documentId="fo1" libraryHref="/acme/team/documents" onBackToList={vi.fn()} />
        </WorkspaceProvider>
      </FeatureFlagsProvider>,
      nav,
    ),
  );
}

beforeEach(() => {
  requestMock.mockReset();
  localStorage.clear();
});

describe("DocumentDetailView on a folder (UNI-1994)", () => {
  it("replaces /documents/<folderId> with the folder page and never shows the no-file banner", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(path.startsWith("/api/v1/config") ? { flags: { documents: true }, rum_sample_rate: 0 } : folderBody("fo1")),
    );
    const nav = fakeNav("/acme/team/documents/fo1");
    renderFolder(nav);
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith(paths.workspace("acme", "team").documentsFolder("fo1")));
    expect(nav.push).not.toHaveBeenCalled();
    expect(screen.queryByText(t("documents.file.missing_file"))).toBeNull();
  });

  it("does not redirect a page document", async () => {
    requestMock.mockImplementation((path: string) =>
      Promise.resolve(
        path.startsWith("/api/v1/config")
          ? { flags: { documents: true }, rum_sample_rate: 0 }
          : { document: { ...folderBody("fo1").document, kind: "page", title: "Biên bản" } },
      ),
    );
    const nav = fakeNav("/acme/team/documents/fo1");
    renderFolder(nav);
    await waitFor(() => expect(requestMock.mock.calls.some(([path]) => String(path).includes("/documents/fo1"))).toBe(true));
    // Let the answer land and the effects run before asserting nothing navigated.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("does not redirect a cached folder whose refetch errored", async () => {
    const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
    const key = documentKeys.detail(WS, "fo1");
    const denied = new ApiError("no access", "document_restricted", 403);
    // The state a failed refetch leaves: the folder still cached, the error set.
    client.setQueryData(key, folderBody("fo1").document);
    await client.fetchQuery({ queryKey: key, queryFn: () => Promise.reject(denied), staleTime: 0 }).catch(() => undefined);
    requestMock.mockImplementation((path: string) =>
      path.startsWith("/api/v1/config") ? Promise.resolve({ flags: { documents: true }, rum_sample_rate: 0 }) : Promise.reject(denied),
    );
    const nav = fakeNav("/acme/team/documents/fo1");
    render(
      wrapWithNav(
        <FeatureFlagsProvider service={service}>
          <WorkspaceProvider workspace={workspace} user={user}>
            <DocumentDetailView wsId={WS} documentId="fo1" libraryHref="/acme/team/documents" onBackToList={vi.fn()} />
          </WorkspaceProvider>
        </FeatureFlagsProvider>,
        nav,
        client,
      ),
    );
    await waitFor(() => expect(client.getQueryState(key)?.status).toBe("error"));
    await waitFor(() => expect(client.getQueryState(key)?.fetchStatus).toBe("idle"));
    expect(nav.replace).not.toHaveBeenCalled();
  });
});

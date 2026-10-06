import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { LocaleAdapterProvider } from "@uniwork/core/i18n/react";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { NavigationProvider, registerLeaveGuard, type NavigationAdapter } from "../navigation";
import { localeAdapter, requestMock } from "../test/api-mock";
import { DocumentWorkspace } from "./document-workspace";

const { t } = initI18n();
const WS = "ws1";

function fileDocument(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
    id: "d1", workspace_id: WS, organization_id: "org1", kind: "file", title: "Báo cáo", revision: "3", current_version: 2, my_level: "edit",
    file: { file_id: "f1", version_id: "v2", version: 2, filename: "báo-cáo.pdf", mime_type: "application/pdf", size_bytes: 1024, checksum_sha256: "a".repeat(64) },
    created_at: "2026-09-28T03:00:00Z", updated_at: "2026-09-28T03:00:00Z", ...over,
  });
  return { ...parsed, kind: "file", visibility: parsed.visibility as Document["visibility"], my_level: parsed.my_level as Document["my_level"], via: parsed.via as Document["via"], owner_kind: parsed.owner_kind as Document["owner_kind"] };
}

const orgConfig = (flags: Record<string, boolean>) => requestMock.mockImplementation((path: string) => {
  if (path === "/api/v1/config?organization_id=org1") return Promise.resolve({ flags });
  return Promise.resolve({ versions: [], next_cursor: null });
});

const adapter: NavigationAdapter = {
  push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/acme/doi/documents/d1", searchParams: new URLSearchParams(), getShareableUrl: (path) => path,
};

function renderWorkspace(qc: QueryClient, doc: Document, withHost = true) {
  const officeHost = () => <div data-testid="office-host">Office host</div>;
  return render(
    <QueryClientProvider client={qc}>
      <LocaleAdapterProvider adapter={localeAdapter}>
        <NavigationProvider value={adapter}>
          <DocumentWorkspace wsId={WS} doc={doc} libraryHref="/acme/doi/documents" refetch={vi.fn(() => Promise.resolve({}))}
            officeEditorHost={withHost ? officeHost : undefined} />
        </NavigationProvider>
      </LocaleAdapterProvider>
    </QueryClientProvider>,
  );
}

const testClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
/** The page container directly around the file view or the editor host. */
const container = () => screen.getByTestId("office-host").parentElement as HTMLElement;

beforeEach(() => { requestMock.mockReset(); });

describe("DocumentWorkspace on a file document", () => {
  it("keeps the editor layout while a refused leave guard keeps the editor mounted (R3)", async () => {
    const qc = testClient();
    orgConfig({ office_engine: true });
    renderWorkspace(qc, fileDocument());
    expect(await screen.findByTestId("office-host")).toBeInTheDocument();
    expect(container()).toHaveClass("overflow-hidden");
    expect(container()).not.toHaveClass("overflow-y-auto");

    // A settled off answer, but the dirty editor refuses to close: editor and layout both stay.
    const guard = vi.fn().mockResolvedValue(false);
    const release = registerLeaveGuard(guard);
    orgConfig({ office_engine: true, office_pdf: false });
    await act(async () => { await qc.invalidateQueries({ queryKey: ["office-public-config"] }); });
    await waitFor(() => expect(guard).toHaveBeenCalled());
    expect(screen.getByTestId("office-host")).toBeInTheDocument();
    expect(container()).toHaveClass("overflow-hidden");
    expect(container()).not.toHaveClass("overflow-y-auto");
    release();
  });

  it("states the permission reason once for a view-only reader on the file card (R15)", async () => {
    orgConfig({ office_engine: true, office_pdf: false });
    renderWorkspace(testClient(), fileDocument({ my_level: "view" }));
    expect(await screen.findByText(t("documents.file.office_off_title", { format: "PDF" }))).toBeInTheDocument();
    expect(screen.getAllByText(t("documents.detail.readonly_description"))).toHaveLength(1);
    expect(screen.queryByTestId("document-file-readonly")).toBeNull();
  });
});

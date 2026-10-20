import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
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
  return { ...parsed, kind: "file", visibility: parsed.visibility as Document["visibility"], my_level: parsed.my_level as Document["my_level"], via: parsed.via as Document["via"], owner_kind: parsed.owner_kind as Document["owner_kind"], system_kind: parsed.system_kind as Document["system_kind"], };
}

const orgConfig = (flags: Record<string, boolean>) => requestMock.mockImplementation((path: string) => {
  if (path === "/api/v1/config?organization_id=org1") return Promise.resolve({ flags });
  return Promise.resolve({ versions: [], next_cursor: null });
});

const adapter: NavigationAdapter = {
  push: vi.fn(), replace: vi.fn(), back: vi.fn(), pathname: "/acme/doi/documents/d1", searchParams: new URLSearchParams(), getShareableUrl: (path) => path,
};

function renderWorkspace(qc: QueryClient, doc: Document, withHost = true, flags: Record<string, boolean> = {}) {
  const officeHost = () => <div data-testid="office-host">Office host</div>;
  const service = new FeatureFlagService(new StaticProvider(
    Object.fromEntries(Object.entries(flags).map(([key, on]) => [key, { default: on }])),
  ));
  return render(
    <QueryClientProvider client={qc}>
      <FeatureFlagsProvider service={service}>
        <LocaleAdapterProvider adapter={localeAdapter}>
          <NavigationProvider value={adapter}>
            <DocumentWorkspace wsId={WS} doc={doc} libraryHref="/acme/doi/documents" refetch={vi.fn(() => Promise.resolve({}))}
              officeEditorHost={withHost ? officeHost : undefined} />
          </NavigationProvider>
        </LocaleAdapterProvider>
      </FeatureFlagsProvider>
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

  it("announces view-only once on a file, in the banner, and gives the title the width on a phone", async () => {
    orgConfig({ office_engine: true });
    renderWorkspace(testClient(), fileDocument({ my_level: "view" }));
    await screen.findByTestId("office-host");
    // One visible announcement (the banner, with its reason); the header chip is gone.
    expect(screen.getAllByText(t("documents.detail.readonly_title"), { exact: false })).toHaveLength(1);
    const banner = screen.getByRole("status");
    expect(banner).toHaveTextContent(t("documents.detail.readonly_description"));
    expect(banner.className).not.toContain("hidden");
    // The title carries the full name for a tooltip; the crumb leaves room on a phone.
    const title = screen.getByText("Báo cáo");
    expect(title).toHaveAttribute("title", "Báo cáo");
    expect(screen.getByRole("link", { name: t("documents.detail.breadcrumb_library") })).toHaveClass("hidden", "sm:inline");
  });

  it("mounts the editor layout for a .txt file when the organization's answer turns office_txt_open on, global off (UNI-1813)", async () => {
    orgConfig({ office_engine: true, office_txt_open: true });
    const txt = fileDocument({ file: { file_id: "f1", version_id: "v2", version: 2, filename: "ghi-chu.txt", mime_type: "text/plain", size_bytes: 128, checksum_sha256: "b".repeat(64) } });

    // The workspace's own usesOfficeEditor answer mounts the editor layout;
    // the global flag is absent (off default), the organization says on.
    renderWorkspace(testClient(), txt, true);
    expect(await screen.findByTestId("office-host")).toBeInTheDocument();
    expect(container()).toHaveClass("overflow-hidden");
    expect(container()).not.toHaveClass("overflow-y-auto");
    expect(screen.queryByRole("button", { name: t("documents.file.download") })).toBeNull();
  });

  it("keeps the file-card layout for the same .txt file when the organization's answer turns office_txt_open off, global on (UNI-1813)", async () => {
    orgConfig({ office_engine: true, office_txt_open: false });
    const txt = fileDocument({ file: { file_id: "f1", version_id: "v2", version: 2, filename: "ghi-chu.txt", mime_type: "text/plain", size_bytes: 128, checksum_sha256: "b".repeat(64) } });

    renderWorkspace(testClient(), txt, true, { office_txt_open: true });
    // The card: filename, download command and the no-web-editor notice; no host.
    expect(await screen.findByText("ghi-chu.txt")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("documents.file.download") })).toBeInTheDocument();
    expect(await screen.findByText(t("documents.file.no_web_editor_title"), { exact: false })).toBeInTheDocument();
    expect(screen.queryByTestId("office-host")).toBeNull();
    // And the workspace wraps it in the card layout, not the editor's.
    const cardWrapper = screen.getByText("ghi-chu.txt").closest("div.flex.flex-col.gap-4")?.parentElement;
    expect(cardWrapper).toHaveClass("overflow-y-auto");
    expect(cardWrapper).not.toHaveClass("overflow-hidden");
  });
});

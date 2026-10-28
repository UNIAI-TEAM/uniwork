import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

// A file dropped on Mẫu văn bản becomes a template, exactly like the picker:
// never a silent upload into My Folder. The drop zone there is the screen's own.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), warning: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const BASE = `/api/v1/workspaces/${WS}/documents`;
const THRESHOLD = 5 * 1024 * 1024;
const user = { id: "u1", email: "an@example.com", display_name: "An", locale: "vi" } as User;
const workspace: Workspace = { id: WS, slug: "doi", name: "Đội", organization_id: "org1", organization_slug: "acme", organization_name: "Acme" };

const created = {
  id: "n1",
  organization_id: "org1",
  workspace_id: WS,
  kind: "file",
  title: "Báo giá.docx",
  format: "docx",
  visibility: "workspace",
  revision: "1",
  current_version: 1,
  position: 0,
  my_level: "edit",
  created_by: "u1",
  created_by_kind: "human",
  updated_by: "u1",
  updated_by_kind: "human",
  created_at: "2026-10-27T01:00:00Z",
  updated_at: "2026-10-27T02:00:00Z",
  file: { file_id: "f1", version_id: "v1", version: 1, filename: "Báo giá.docx", mime_type: "application/octet-stream", size_bytes: 5, checksum_sha256: "a".repeat(64) },
};

function route() {
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith("/api/v1/config")) {
      return Promise.resolve({
        flags: { office_engine: true },
        documents: { limits: { upload_max_bytes: 200 * 1024 * 1024, chunked_upload_threshold_bytes: THRESHOLD } },
      });
    }
    if (path === `${BASE}/files` && opts?.method === "POST") return Promise.resolve({ document: created });
    if (path.startsWith(`${BASE}/templates`)) return Promise.resolve({ documents: [], next_cursor: null });
    if (path.startsWith(`${BASE}/tree`)) return Promise.resolve({ documents: [] });
    if (path.startsWith(BASE)) return Promise.resolve({ documents: [], next_cursor: null });
    return Promise.resolve({});
  });
}

const nav: NavigationAdapter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
  pathname: "/acme/doi/documents",
  searchParams: new URLSearchParams("view=templates"),
  getShareableUrl: (p) => p,
};

async function renderTemplates() {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  render(
    wrap(
      <NavigationProvider value={nav}>
        <WorkspaceProvider workspace={workspace} user={user}>
          <FeatureFlagsProvider service={service}>
            <DocumentsPageView wsId={WS} onOpen={vi.fn()} />
          </FeatureFlagsProvider>
        </WorkspaceProvider>
      </NavigationProvider>,
    ),
  );
  await screen.findByText(t("documents.home.empty.templates_title"));
  await waitFor(() => expect(requestMock.mock.calls.some(([path]) => String(path).startsWith("/api/v1/config"))).toBe(true));
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return screen.getByRole("region", { name: t("documents.page.title") });
}

const posts = () =>
  requestMock.mock.calls.filter(([path, opts]) => path === `${BASE}/files` && (opts as { method?: string } | undefined)?.method === "POST");

const files = (...list: File[]) => ({ types: ["Files"], files: list, items: [], dropEffect: "none" });

beforeEach(() => {
  requestMock.mockReset();
  for (const fn of Object.values(toast)) fn.mockReset();
  resetAuthStoreForTests();
  setSessionUser({ ...user, onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {} });
  route();
});

describe("dropping files on Mẫu văn bản", () => {
  it("uploads a dropped file as a workspace template with no destination and no parent", async () => {
    const zone = await renderTemplates();
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: files(new File(["x"], "Báo giá.docx")) });
    });
    await waitFor(() => expect(posts()).toHaveLength(1));
    const form = (posts()[0]?.[1] as { body: FormData }).body;
    expect(form.get("visibility")).toBe("workspace");
    expect(form.get("template")).toBe("true");
    expect(form.has("destination")).toBe(false);
    expect(form.has("parent_id")).toBe(false);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.templates.uploaded", { title: "Báo giá.docx" })));
  });

  it("uploads several dropped files one by one", async () => {
    const zone = await renderTemplates();
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: files(new File(["x"], "a.docx"), new File(["y"], "b.docx")) });
    });
    await waitFor(() => expect(posts()).toHaveLength(2));
  });

  it("refuses a dropped file above the threshold and sends nothing", async () => {
    const zone = await renderTemplates();
    const big = new File(["x"], "Lớn.docx");
    Object.defineProperty(big, "size", { value: THRESHOLD + 1 });
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: files(big) });
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.templates.too_large", { size: "5 MB" })));
    expect(posts()).toHaveLength(0);
  });

  it("refuses a dropped folder and sends nothing", async () => {
    const zone = await renderTemplates();
    const items = [{ kind: "file", webkitGetAsEntry: () => ({ isDirectory: true, isFile: false }), getAsFile: () => new File([], "Thư mục") }];
    await act(async () => {
      fireEvent.drop(zone, { dataTransfer: { types: ["Files"], files: [new File([], "Thư mục")], items, dropEffect: "none" } });
    });
    expect(toast.error).toHaveBeenCalledWith(t("documents.templates.no_folders"));
    expect(posts()).toHaveLength(0);
  });

  it("names the Templates destination on the overlay and keeps the browser from opening the file", async () => {
    const zone = await renderTemplates();
    const enter = fireEvent.dragEnter(zone, { dataTransfer: files() });
    expect(enter).toBe(false);
    expect(await screen.findByTestId("documents-drop-label")).toHaveTextContent(t("documents.templates.drop_hint"));
    expect(fireEvent.dragOver(zone, { dataTransfer: files() })).toBe(false);
    expect(fireEvent.drop(zone, { dataTransfer: files(new File(["x"], "a.docx")) })).toBe(false);
  });
});

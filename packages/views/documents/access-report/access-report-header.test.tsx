import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import en from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { fakeNav, requestMock, wrapWithNav } from "../../test/api-mock";
import { formatWhen } from "../document-format";
import { AccessReportHeader, type AccessReportHeaderProps } from "./access-report-header";

// The header of the access report (UNI-2039 F1): breadcrumb and title, the
// scope picker (whole workspace or one folder), when the report was made, a
// refresh, and ONE export menu with CSV and Excel.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const download = vi.hoisted(() => vi.fn());
vi.mock("@uniwork/core/api/http", async (original) => {
  const { requestMock: transport } = await import("../../test/request-mock");
  return {
    ...(await original<typeof import("@uniwork/core/api/http")>()),
    request: (...args: unknown[]) => transport(...args),
    requestDownload: (...args: unknown[]) => download(...args),
  };
});

const { t } = initI18n();

const WS = "ws1";
const TREE_PATH = `/api/v1/workspaces/${WS}/documents/tree`;
const EXPORT_PATH = `/api/v1/workspaces/${WS}/documents/access-report/export`;

const forest = [
  {
    id: "f1",
    title: "Hợp đồng",
    kind: "folder",
    parent_id: null,
    position: 0,
    children: [{ id: "f1-sub", title: "Phụ lục", kind: "folder", parent_id: "f1", position: 0, children: [] }],
  },
  { id: "f2", title: "Tài chính", kind: "folder", parent_id: null, position: 1, children: [] },
];

function renderHeader(over: Partial<AccessReportHeaderProps> = {}) {
  const props: AccessReportHeaderProps = {
    wsId: WS,
    workspaceName: "Đội",
    workspaceSlug: "doi",
    libraryHref: "/acme/doi/documents",
    folderId: undefined,
    folderTitle: null,
    filters: {},
    generatedAt: "2026-10-15T03:40:00Z",
    onFolderChange: vi.fn(),
    onRefresh: vi.fn(),
    ...over,
  };
  render(wrapWithNav(<AccessReportHeader {...props} />, fakeNav("/acme/doi/documents/access-report")));
  return props;
}

const exportTrigger = () => screen.getByRole("button", { name: t("documents.accessReport.export") });

async function openExportMenu() {
  fireEvent.click(exportTrigger());
  return screen.findByRole("menu");
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockImplementation(async (path: string) => {
    if (new URL(path, "http://api.test").pathname === TREE_PATH) return { documents: forest };
    throw new Error(`unexpected request ${path}`);
  });
  download.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("AccessReportHeader - the new copy", () => {
  it.each(["updated_at", "refresh", "export", "scope_label", "scope_pick_folder"])("has %s in vi and en", (key) => {
    expect((viLocale.documents.accessReport as Record<string, string>)[key]).toBeTruthy();
    expect((en.documents.accessReport as Record<string, string>)[key]).toBeTruthy();
  });
});

describe("AccessReportHeader - title", () => {
  it("shows the breadcrumb back to the library and the title as the one h1", () => {
    renderHeader();
    const crumbs = screen.getByRole("navigation", { name: /breadcrumb/i });
    const library = within(crumbs).getByRole("link", { name: t("documents.page.title") });
    expect(library).toHaveAttribute("href", "/acme/doi/documents");
    expect(within(crumbs).getByText(t("documents.accessReport.title"))).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("heading", { level: 1, name: t("documents.accessReport.title") })).toBeInTheDocument();
  });
});

describe("AccessReportHeader - scope", () => {
  it("names the whole workspace when no folder is picked", () => {
    renderHeader();
    expect(
      screen.getByRole("button", { name: new RegExp(t("documents.accessReport.scope_workspace", { name: "Đội" })) }),
    ).toBeInTheDocument();
  });

  it("names the folder the report is for", () => {
    renderHeader({ folderId: "f1", folderTitle: "Hợp đồng" });
    expect(
      screen.getByRole("button", { name: new RegExp(t("documents.accessReport.scope_folder", { path: "Hợp đồng" }).replace(/[()]/g, "\\$&")) }),
    ).toBeInTheDocument();
  });

  it("picks a folder from the folder tree and hands its id to the screen", async () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.accessReport.scope_workspace", { name: "Đội" })) }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(await within(dialog).findByRole("treeitem", { name: /Tài chính/ }));
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.done") }));
    await waitFor(() => expect(props.onFolderChange).toHaveBeenCalledWith("f2"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("goes back to the whole workspace from the root row", async () => {
    const props = renderHeader({ folderId: "f1", folderTitle: "Hợp đồng" });
    fireEvent.click(screen.getByRole("button", { name: /Hợp đồng/ }));
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByRole("treeitem", { name: /Tài chính/ });
    fireEvent.click(within(dialog).getAllByRole("treeitem")[0]!);
    fireEvent.click(within(dialog).getByRole("button", { name: t("common.done") }));
    await waitFor(() => expect(props.onFolderChange).toHaveBeenCalledWith(undefined));
  });

  it("does not read the folder tree until the picker is opened", () => {
    renderHeader();
    expect(requestMock).not.toHaveBeenCalled();
  });
});

describe("AccessReportHeader - freshness", () => {
  it("says when the report was made, from generated_at", () => {
    renderHeader();
    expect(screen.getByText(t("documents.accessReport.updated_at", { time: formatWhen("2026-10-15T03:40:00Z", "vi") }))).toBeInTheDocument();
  });

  it("says nothing about time before the first page has arrived", () => {
    renderHeader({ generatedAt: null });
    expect(screen.queryByText(/^documents\.accessReport\.updated_at|^Cập nhật lúc /)).toBeNull();
    expect(screen.queryByText("·")).toBeNull();
  });

  it("refreshes through the screen's callback", () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessReport.refresh") }));
    expect(props.onRefresh).toHaveBeenCalledTimes(1);
  });

  it("is aria-disabled while refreshing and ignores the click", () => {
    const props = renderHeader({ refreshing: true });
    const button = screen.getByRole("button", { name: t("documents.accessReport.refresh") });
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(props.onRefresh).not.toHaveBeenCalled();
  });
});

describe("AccessReportHeader - export", () => {
  beforeEach(() => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() }));
  });

  it("is one menu button that offers CSV and Excel, not two buttons", async () => {
    renderHeader();
    expect(screen.queryByRole("button", { name: t("documents.accessReport.export_csv") })).toBeNull();
    const menu = await openExportMenu();
    expect(within(menu).getAllByRole("menuitem").map((item) => item.textContent)).toEqual([
      t("documents.accessReport.export_csv"),
      t("documents.accessReport.export_xlsx"),
    ]);
  });

  it("exports with the folder and filters of the screen and saves under the server's filename", async () => {
    const saved: string[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      saved.push(this.download);
    });
    download.mockResolvedValueOnce({ blob: new Blob(["a"]), filename: "access-report-doi-20261015T0340Z.csv" });
    renderHeader({ folderId: "f1", folderTitle: "Hợp đồng", filters: { personId: "u2", levels: ["edit", "manage"], visibility: "restricted" } });

    const menu = await openExportMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.accessReport.export_csv") }));

    await waitFor(() => expect(saved).toEqual(["access-report-doi-20261015T0340Z.csv"]));
    const url = new URL(String(download.mock.calls[0]![0]), "http://api.test");
    expect(url.pathname).toBe(EXPORT_PATH);
    expect(url.searchParams.get("format")).toBe("csv");
    expect(url.searchParams.get("folder_id")).toBe("f1");
    expect(url.searchParams.get("person_id")).toBe("u2");
    expect(url.searchParams.get("level")).toBe("edit,manage");
    expect(url.searchParams.get("visibility")).toBe("restricted");
    click.mockRestore();
  });

  it("asks for Excel from the second item", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    download.mockResolvedValueOnce({ blob: new Blob(["b"]), filename: null });
    renderHeader();
    const menu = await openExportMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.accessReport.export_xlsx") }));
    await waitFor(() => expect(download).toHaveBeenCalledTimes(1));
    expect(new URL(String(download.mock.calls[0]![0]), "http://api.test").searchParams.get("format")).toBe("xlsx");
  });

  it("is aria-disabled while a file is being made and does not open or start a second export", async () => {
    let finish: (v: { blob: Blob; filename: string | null }) => void = () => {};
    download.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderHeader();

    const menu = await openExportMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.accessReport.export_csv") }));
    const busy = await screen.findByRole("button", { name: t("documents.accessReport.exporting") });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(busy).toHaveAttribute("aria-busy", "true");

    fireEvent.click(busy);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(download).toHaveBeenCalledTimes(1);

    finish({ blob: new Blob(["a"]), filename: "x.csv" });
    await waitFor(() => expect(exportTrigger()).not.toHaveAttribute("aria-disabled", "true"));
  });

  it("a report over the row cap shows the too-large advice", async () => {
    download.mockRejectedValueOnce(new ApiError("too big", "access_report_too_large", 422, undefined, { max_rows: 10000 }));
    renderHeader();
    const menu = await openExportMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.accessReport.export_xlsx") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.accessReport.too_large", { max: 10000 })));
  });

  it("any other failure shows the generic message", async () => {
    download.mockRejectedValueOnce(new ApiError("boom", "internal", 500));
    renderHeader();
    const menu = await openExportMenu();
    fireEvent.click(within(menu).getByRole("menuitem", { name: t("documents.accessReport.export_csv") }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.accessReport.export_failed")));
  });

  it("points the trigger at a note the screen shows about an empty file", () => {
    renderHeader({ exportDescribedBy: "empty-note" });
    expect(exportTrigger()).toHaveAttribute("aria-describedby", "empty-note");
  });
});

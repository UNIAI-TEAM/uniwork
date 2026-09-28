import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import {
  FeatureFlagsProvider,
  FeatureFlagService,
  StaticProvider,
} from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentsPageView } from "./documents-page-view";

const { t } = initI18n();

const WS = "ws1";
const TREE_URL = `/api/v1/workspaces/${WS}/documents/tree`;
const LIST_BASE = `/api/v1/workspaces/${WS}/documents`;

/** The screen is gated by `documents`; the flag has to be on to see anything. */
function withFlag(ui: React.ReactElement, on: boolean) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: on } }));
  return wrapWithNav(<FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>);
}

function summary(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Kế hoạch Q4",
    revision: "1",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

function treeNode(over: Record<string, unknown> = {}) {
  return { id: "t1", title: "Nhóm", kind: "page", position: 0, children: [], ...over };
}

function renderView(onOpen: (id: string) => void, on = true) {
  return render(withFlag(<DocumentsPageView wsId={WS} onOpen={onOpen} />, on));
}

function queryOf(path: string) {
  return new URLSearchParams(path.split("?")[1] ?? "");
}

function postCall(method: string) {
  return requestMock.mock.calls.find(
    ([, opts]) => (opts as { method?: string } | undefined)?.method === method,
  );
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("DocumentsPageView", () => {
  it("stays behind its flag", () => {
    const onOpen = vi.fn();
    renderView(onOpen, false);
    expect(screen.getByText(t("documents.page.off_title"))).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("translates its library copy instead of falling back to keys", () => {
    // A missing key renders as the key itself and the screen would read
    // "documents.library.tabs.all" in production.
    expect(t("documents.library.tabs.all")).not.toBe("documents.library.tabs.all");
    expect(t("documents.library.empty_title")).not.toBe("documents.library.empty_title");
    expect(t("documents.tree.empty")).not.toBe("documents.tree.empty");
  });

  it("lists the rows the server returned and counts them on the tab", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) {
        return Promise.resolve({
          documents: [summary(), summary({ id: "d2", title: "Biên bản họp" })],
          next_cursor: null,
        });
      }
      return Promise.resolve({});
    });

    renderView(vi.fn());

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.getByText("Biên bản họp")).toBeInTheDocument();
    // The tab shows the loaded row count from the server, not a made-up one.
    const tab = screen.getByRole("tab", { name: new RegExp(t("documents.library.tabs.all")) });
    expect(within(tab).getByText("2")).toBeInTheDocument();
  });

  it("shows skeleton rows while the first page loads, never fake rows", () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith(TREE_URL) ? Promise.resolve({ documents: [] }) : new Promise(() => {}),
    );
    renderView(vi.fn());

    expect(screen.getByLabelText(t("documents.library.loading"))).toHaveAttribute("aria-busy", "true");
    expect(screen.queryByText("Kế hoạch Q4")).toBeNull();
  });

  it("offers create and upload when the library is truly empty", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    renderView(vi.fn());

    expect(await screen.findByText(t("documents.library.empty_title"))).toBeInTheDocument();
    expect(
      screen.getAllByRole("button", { name: t("documents.page.new_page") }).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByRole("button", { name: t("documents.page.upload_file") }).length,
    ).toBeGreaterThan(0);
  });

  it("offers a retry when the list cannot be read", async () => {
    let listCalls = 0;
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      listCalls += 1;
      return listCalls === 1
        ? Promise.reject(new ApiError("boom", "internal", 500))
        : Promise.resolve({ documents: [summary()], next_cursor: null });
    });
    renderView(vi.fn());

    expect(await screen.findByText(t("documents.library.error_title"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.retry") }));

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("loads another cursor page only when load more is clicked", async () => {
    const urls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      urls.push(path);
      if (queryOf(path).get("cursor") === "c2") {
        return Promise.resolve({ documents: [summary({ id: "d2", title: "Trang hai" })], next_cursor: null });
      }
      return Promise.resolve({ documents: [summary()], next_cursor: "c2" });
    });
    renderView(vi.fn());

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
    expect(screen.queryByText("Trang hai")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: t("documents.library.load_more") }));

    expect(await screen.findByText("Trang hai")).toBeInTheDocument();
    expect(urls.some((url) => queryOf(url).get("cursor") === "c2")).toBe(true);
  });

  it("sends the chosen kind filter to the server and shows the filtered empty state", async () => {
    const urls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      urls.push(path);
      if (queryOf(path).get("kind") === "file") {
        return Promise.resolve({ documents: [], next_cursor: null });
      }
      return Promise.resolve({ documents: [summary()], next_cursor: null });
    });
    renderView(vi.fn());

    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("combobox", { name: t("documents.library.filters.kind_label") }));
    const listbox = await screen.findByRole("listbox");
    const fileOption = within(listbox).getByText(t("documents.library.filters.kind_file"));
    // Base UI only commits a click that started on the item with a pointer.
    fireEvent.pointerDown(fileOption);
    fireEvent.click(fileOption);

    expect(await screen.findByText(t("documents.library.no_matches_title"))).toBeInTheDocument();
    await waitFor(() => expect(urls.some((url) => queryOf(url).get("kind") === "file")).toBe(true));
    // Clearing the filter asks the server for the library again.
    fireEvent.click(screen.getByRole("button", { name: t("documents.library.clear_filters") }));
    expect(await screen.findByText("Kế hoạch Q4")).toBeInTheDocument();
  });

  it("sends a date window to the server", async () => {
    const urls: string[] = [];
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      urls.push(path);
      return Promise.resolve({ documents: [summary()], next_cursor: null });
    });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(screen.getByRole("combobox", { name: t("documents.library.filters.date_label") }));
    const listbox = await screen.findByRole("listbox");
    const weekOption = within(listbox).getByText(t("documents.library.filters.date_week"));
    fireEvent.pointerDown(weekOption);
    fireEvent.click(weekOption);

    await waitFor(() => {
      const sent = urls.some((url) => {
        const q = queryOf(url);
        // Only the lower bound is sent: a frozen upper bound would hide a
        // document updated after the filter was picked.
        return q.get("updated_from") !== null && q.get("updated_to") === null;
      });
      expect(sent).toBe(true);
    });
  });

  it("explains the archive permission instead of rendering an empty archive", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (queryOf(path).get("archived") === "1") {
        return Promise.reject(new ApiError("forbidden", "forbidden", 403));
      }
      if (path.startsWith(LIST_BASE)) {
        return Promise.resolve({ documents: [summary()], next_cursor: null });
      }
      return Promise.resolve({});
    });
    renderView(vi.fn());
    await screen.findByText("Kế hoạch Q4");

    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t("documents.library.tabs.archived")) }));

    expect(await screen.findByText(t("documents.library.permission_title"))).toBeInTheDocument();
  });

  it("loads the recent and shared tabs from their own endpoints", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path.startsWith(`${LIST_BASE}/recent`)) {
        return Promise.resolve({ documents: [summary({ id: "r1", title: "Mở gần đây" })], next_cursor: null });
      }
      if (path.startsWith(`${LIST_BASE}/shared-with-me`)) {
        return Promise.resolve({ documents: [summary({ id: "s1", title: "Được chia sẻ" })], next_cursor: null });
      }
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    renderView(vi.fn());
    await screen.findByText(t("documents.library.empty_title"));

    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t("documents.library.tabs.recent")) }));
    expect(await screen.findByText("Mở gần đây")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: new RegExp(t("documents.library.tabs.shared")) }));
    expect(await screen.findByText("Được chia sẻ")).toBeInTheDocument();
  });

  it("renders the tree and opens a document from a branch", async () => {
    const onOpen = vi.fn();
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) {
        return Promise.resolve({
          documents: [
            treeNode({
              id: "root1",
              title: "Nhóm",
              children: [treeNode({ id: "child1", title: "Trang con", parent_id: "root1" })],
            }),
          ],
        });
      }
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    renderView(onOpen);

    const root = await screen.findByRole("treeitem", { name: /Nhóm/ });
    expect(root).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(within(root).getByRole("button", { name: t("documents.tree.expand", { title: "Nhóm" }) }));

    const child = await screen.findByRole("treeitem", { name: /Trang con/ });
    fireEvent.click(child);

    expect(onOpen).toHaveBeenCalledWith("child1");
  });

  it("creates a page and opens it", async () => {
    const onOpen = vi.fn();
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (opts?.method === "POST") return Promise.resolve({ document: summary() });
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    renderView(onOpen);

    fireEvent.click(screen.getAllByRole("button", { name: t("documents.page.new_page") })[0]!);

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d1"));
    const call = postCall("POST");
    expect(call?.[0]).toBe(LIST_BASE);
    expect((call?.[1] as { body?: { title?: string } }).body?.title).toBe(t("documents.page.new_page"));
  });

  it("uploads a file and opens the new document", async () => {
    const onOpen = vi.fn();
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path === `${LIST_BASE}/files`) {
        return Promise.resolve({
          document: summary({
            id: "d2",
            kind: "file",
            // A file document without its FileService reference is not
            // usable, and the hook refuses the answer.
            file: {
              file_id: "f1",
              version_id: "v1",
              version: 1,
              filename: "note.txt",
              mime_type: "text/plain",
              size_bytes: 5,
              checksum_sha256: "a".repeat(64),
            },
          }),
        });
      }
      void opts;
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    renderView(onOpen);

    fireEvent.click(screen.getAllByRole("button", { name: t("documents.page.upload_file") })[0]!);
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    const file = new File(["hello"], "note.txt", { type: "text/plain" });
    fireEvent.change(input, { target: { files: [file] } });
    expect(screen.getByTestId("document-upload-selected")).toHaveTextContent("note.txt");

    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    await waitFor(() => expect(onOpen).toHaveBeenCalledWith("d2"));
    expect(
      requestMock.mock.calls.some(([path]) => path === `${LIST_BASE}/files`),
    ).toBe(true);
  });

  it("keeps a failed upload in the dialog with the reason", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith(TREE_URL)) return Promise.resolve({ documents: [] });
      if (path === `${LIST_BASE}/files`) return Promise.reject(new Error("boom"));
      if (path.startsWith(LIST_BASE)) return Promise.resolve({ documents: [], next_cursor: null });
      return Promise.resolve({});
    });
    renderView(vi.fn());

    fireEvent.click(screen.getAllByRole("button", { name: t("documents.page.upload_file") })[0]!);
    const input = await screen.findByLabelText(t("documents.upload.pick"));
    fireEvent.change(input, {
      target: { files: [new File(["hello"], "note.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: t("documents.upload.submit") }));

    expect(await screen.findByRole("alert")).toHaveTextContent("boom");
    // The picked file is still there, so the retry does not re-pick it.
    expect(screen.getByTestId("document-upload-selected")).toBeInTheDocument();
  });
});

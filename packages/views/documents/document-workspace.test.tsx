import { StrictMode } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentWorkspace } from "./document-workspace";

const { t } = initI18n();

const WS = "ws1";
const LIBRARY = "/acme/doi/documents";

const PAGE_CONTENT = {
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text: "Nội dung A" }] }],
};

/** Parsed through the wire schema, like every documents response in the app. */
/** The wire schema parses server enums leniently; the exported type narrows them. */
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

function pageDocument(over: Record<string, unknown> = {}): Document {
  return narrowDocument(DocumentSchema.parse({
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Kế hoạch Q3",
    content: PAGE_CONTENT,
    content_text: "Nội dung A",
    revision: "3",
    current_version: 1,
    my_level: "edit",
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  }));
}

/** The editor arrives through React.lazy; the first TipTap import is slow. */
function findEditor() {
  return screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });
}

/** Paste through the real ProseMirror handler, the way a user types text in. */
function pasteText(text: string) {
  const surface = screen.getByRole("textbox", { name: t("documents.editor.aria_label") });
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [], getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  fireEvent(surface, event);
}

interface PatchCall {
  body: { revision?: string; content?: { type?: string; content?: unknown } };
  headers?: Record<string, string>;
}

function patchCalls(): PatchCall[] {
  return requestMock.mock.calls
    .filter(([path, opts]) => String(path) === "/api/v1/documents/d1" && (opts as { method?: string })?.method === "PATCH")
    .map(([, opts]) => opts as PatchCall);
}

function renderWorkspace(
  over: Record<string, unknown> = {},
  refetch = vi.fn(() => Promise.resolve({})),
  strict = false,
) {
  const push = vi.fn();
  const adapter: NavigationAdapter = {
    push,
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents/d1",
    searchParams: new URLSearchParams(),
    getShareableUrl: (path) => path,
  };
  const tree = wrap(
    <NavigationProvider value={adapter}>
      <DocumentWorkspace
        wsId={WS}
        doc={pageDocument(over)}
        libraryHref={LIBRARY}
        refetch={refetch}
      />
    </NavigationProvider>,
  );
  const result = render(strict ? <StrictMode>{tree}</StrictMode> : tree);
  return { push, refetch, ...result };
}

beforeEach(() => {
  requestMock.mockReset();
});

describe("DocumentWorkspace note page UI", () => {
  it("hands focus from title Enter to the body and back on empty first-line Backspace/ArrowUp", async () => {
    renderWorkspace({ content: { type: "doc", content: [{ type: "paragraph" }] } });
    const body = await findEditor();
    const title = screen.getByRole("textbox", { name: t("documents.page_ui.title_label") });
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(() => expect(body).toHaveFocus());
    fireEvent.keyDown(body, { key: "Backspace" });
    expect(title).toHaveFocus();
    fireEvent.keyDown(title, { key: "Enter" });
    await waitFor(() => expect(body).toHaveFocus());
    fireEvent.keyDown(body, { key: "ArrowUp" });
    expect(title).toHaveFocus();
  });

  it("opens the page listbox and Escape preserves the slash without producing a chat command", async () => {
    renderWorkspace({ content: { type: "doc", content: [{ type: "paragraph" }] } });
    const body = await findEditor();
    fireEvent.keyDown(screen.getByRole("textbox", { name: t("documents.page_ui.title_label") }), { key: "Enter" });
    pasteText("/");
    expect(await screen.findByRole("listbox", { name: t("documents.page_ui.insert_block") })).toBeInTheDocument();
    fireEvent.keyDown(body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    expect(body).toHaveTextContent("/");
    expect(body.querySelector("[data-type='slashCommand']")).toBeNull();
  });

  it("has a static title and no metadata controls in read-only mode", async () => {
    renderWorkspace({ my_level: "view", icon: "📝" });
    await findEditor();
    expect(screen.getByRole("heading", { level: 1, name: "Kế hoạch Q3" })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: t("documents.page_ui.title_label") })).toBeNull();
    expect(screen.queryByRole("button", { name: t("documents.page_ui.change_icon") })).toBeNull();
    expect(screen.getAllByText(t("documents.save.readonly"))).toHaveLength(1);
    expect(screen.queryByText(t("documents.detail.readonly_title"))).toBeNull();
  });
});

describe("DocumentWorkspace autosave", () => {
  it("saves the page and only then reports it saved", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/d1" && opts?.method === "PATCH"
        ? Promise.resolve({
            document: pageDocument({ revision: "4", updated_at: "2026-09-28T03:20:00Z" }),
          })
        : Promise.resolve({}),
    );
    renderWorkspace();
    await findEditor();

    expect(screen.queryByText(t("documents.save.saved_at", { time: "" }))).toBeNull();

    pasteText("Xin chào");

    await waitFor(() => expect(screen.getByText(t("documents.save.unsaved"))).toBeInTheDocument());
    await waitFor(() => expect(patchCalls()).toHaveLength(1), { timeout: 8_000 });

    const [call] = patchCalls();
    expect(call?.body.revision).toBe("3");
    expect(call?.body.content?.type).toBe("doc");
    expect(JSON.stringify(call?.body.content)).toContain("Xin chào");
    expect(call?.headers?.["Idempotency-Key"]).toBeTruthy();

    await waitFor(() => expect(screen.getByText(/^Đã lưu/)).toBeInTheDocument(), {
      timeout: 8_000,
    });
  });

  it("keeps the draft and its key when the answer cannot prove the write", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/d1" && opts?.method === "PATCH"
        ? Promise.resolve({ document: { id: "d1" } })
        : Promise.resolve({}),
    );
    renderWorkspace();
    await findEditor();

    pasteText("Chưa xác minh");
    await waitFor(() => expect(patchCalls()).toHaveLength(1), { timeout: 8_000 });

    expect(
      await screen.findByText(t("documents.save.unverified")),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: t("documents.save.retry") }));
    await waitFor(() => expect(patchCalls()).toHaveLength(2), { timeout: 8_000 });

    const [first, second] = patchCalls();
    expect(second?.headers?.["Idempotency-Key"]).toBe(first?.headers?.["Idempotency-Key"]);
    expect(second?.body.revision).toBe("3");
  });

  it("stops on a stale base and re-bases only after the user chooses", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1" && opts?.method === "PATCH") {
        const body = (opts as { body?: { revision?: string } }).body;
        if (body?.revision === "3") {
          return Promise.reject(
            new ApiError("conflict", "revision_conflict", 422, undefined, { current_revision: "9" }, "conflict"),
          );
        }
        return Promise.resolve({ document: pageDocument({ revision: "10" }) });
      }
      return Promise.resolve({});
    });
    // "Keep mine" reads the server's CURRENT base and shows it before anything
    // is committed; the failed save only proved that the base moved. The base
    // carries its text excerpt and a locale-formatted date.
    const refetch = vi.fn(() =>
      Promise.resolve({ data: pageDocument({ revision: "9", updated_at: "2020-01-05T03:30:00Z" }) }),
    );
    renderWorkspace({}, refetch);
    await findEditor();

    pasteText("Bản của tôi");
    expect(
      await screen.findByText(t("documents.conflict.title"), {}, { timeout: 8_000 }),
    ).toBeInTheDocument();

    // Nothing is sent while the dialog is open.
    expect(patchCalls()).toHaveLength(1);
    expect(refetch).not.toHaveBeenCalled();

    // The option button carries its hint line too, so its accessible name
    // is the label plus the hint.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.conflict.keep_mine")) }));

    // Step two shows the base the copy will be written on top of: its
    // revision, its text excerpt, and a date for a copy that is not today's.
    expect(await screen.findByTestId("conflict-server-base")).toHaveTextContent("9");
    const base = screen.getByTestId("conflict-server-base");
    expect(base).toHaveTextContent("Nội dung A");
    expect(base).toHaveTextContent("2020");
    expect(refetch).toHaveBeenCalled();
    expect(patchCalls()).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: t("documents.conflict.confirm_keep_mine") }));

    await waitFor(() => expect(patchCalls()).toHaveLength(2), { timeout: 8_000 });
    expect(patchCalls()[1]?.body.revision).toBe("9");
    await waitFor(() => expect(screen.queryByText(t("documents.conflict.title"))).toBeNull());
  });

  it("asks before leaving a dirty page, and stays when told to", async () => {
    requestMock.mockResolvedValue({ document: pageDocument({ revision: "4" }) });
    const { push } = renderWorkspace();
    await findEditor();

    pasteText("Chưa lưu");
    await waitFor(() => expect(screen.getByText(t("documents.save.unsaved"))).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
    expect(await screen.findByText(t("documents.leave.title"))).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("documents.leave.stay") }));
    await waitFor(() => expect(screen.queryByText(t("documents.leave.title"))).toBeNull());
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
    fireEvent.click(
      await screen.findByRole("button", { name: t("documents.leave.discard") }),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith(LIBRARY));
  });

  it("stops a failed save-and-leave after one retry and re-enables the dialog", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/d1" && opts?.method === "PATCH"
        ? Promise.reject(new ApiError("save_failed", "internal_error", 500))
        : Promise.resolve({}),
    );
    renderWorkspace();
    await findEditor();

    pasteText("Chưa lưu được");

    // The debounced autosave fails first; the draft and its key stay.
    await waitFor(() => expect(patchCalls()).toHaveLength(1), { timeout: 8_000 });

    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
    fireEvent.click(
      await screen.findByRole("button", { name: t("documents.leave.save_and_leave") }),
    );

    // The attempt re-sends the kept draft once, then the failure is terminal:
    // no unbounded PATCH loop and the user can act again (r2 FE review R2-1).
    await waitFor(() => expect(patchCalls()).toHaveLength(2), { timeout: 8_000 });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: t("documents.leave.stay") })).toBeEnabled(),
    );
    expect(screen.getByRole("button", { name: t("documents.leave.discard") })).toBeEnabled();
    expect(screen.getByRole("button", { name: t("documents.leave.save_and_leave") })).toBeEnabled();
    expect(screen.getAllByText(t("documents.save.error")).length).toBeGreaterThan(0);

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(patchCalls()).toHaveLength(2);
  });

  it("keeps keep-mine on step one when the fresh base cannot be read", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/d1" && opts?.method === "PATCH"
        ? Promise.reject(
            new ApiError("conflict", "revision_conflict", 422, undefined, { current_revision: "9" }, "conflict"),
          )
        : Promise.resolve({}),
    );
    // TanStack resolves a failed refetch with the stale cache entry plus
    // `isError`; that copy must never be named "the newest server copy".
    const refetch = vi.fn(() =>
      Promise.resolve({ data: pageDocument({ revision: "9" }), isError: true }),
    );
    renderWorkspace({}, refetch);
    await findEditor();

    pasteText("Bản của tôi");
    await screen.findByText(t("documents.conflict.title"), {}, { timeout: 8_000 });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.conflict.keep_mine")) }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("documents.conflict.keep_mine_error"),
    );
    expect(screen.queryByTestId("conflict-server-base")).toBeNull();

    // The same choice is the retry; a second failure keeps step one.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.conflict.keep_mine")) }));
    await waitFor(() => expect(refetch).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("conflict-server-base")).toBeNull();
    expect(screen.getByRole("alert")).toHaveTextContent(t("documents.conflict.keep_mine_error"));
  });

  it("refuses a server base older than the conflict revision", async () => {
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/d1" && opts?.method === "PATCH"
        ? Promise.reject(
            new ApiError("conflict", "revision_conflict", 422, undefined, { current_revision: "9" }, "conflict"),
          )
        : Promise.resolve({}),
    );
    // A successful refetch can still be behind the revision the conflict
    // named; committing on it would just conflict again.
    const refetch = vi.fn(() => Promise.resolve({ data: pageDocument({ revision: "3" }) }));
    renderWorkspace({}, refetch);
    await findEditor();

    pasteText("Bản của tôi");
    await screen.findByText(t("documents.conflict.title"), {}, { timeout: 8_000 });
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.conflict.keep_mine")) }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t("documents.conflict.keep_mine_error"),
    );
    expect(screen.queryByTestId("conflict-server-base")).toBeNull();
  });

  it("hands a save-and-leave conflict to the conflict dialog instead of waiting", async () => {
    let patches = 0;
    requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
      if (path === "/api/v1/documents/d1" && opts?.method === "PATCH") {
        patches += 1;
        if (patches === 1) return Promise.resolve({ document: pageDocument({ revision: "4" }) });
        return Promise.reject(
          new ApiError("conflict", "revision_conflict", 422, undefined, { current_revision: "9" }, "conflict"),
        );
      }
      return Promise.resolve({});
    });
    const { push } = renderWorkspace();
    await findEditor();

    pasteText("Lần một");
    await waitFor(() => expect(patchCalls()).toHaveLength(1), { timeout: 8_000 });
    await waitFor(() => expect(screen.getByText(/^Đã lưu/)).toBeInTheDocument());

    pasteText("Lần hai");
    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
    fireEvent.click(
      await screen.findByRole("button", { name: t("documents.leave.save_and_leave") }),
    );

    // The base moved under the write: the conflict dialog takes over and the
    // page is not left with a save still owed.
    expect(
      await screen.findByText(t("documents.conflict.title"), {}, { timeout: 8_000 }),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(t("documents.leave.title"))).toBeNull());
    expect(push).not.toHaveBeenCalled();
  });

  it("does not let a page with an image still uploading leave silently", async () => {
    // The upload never settles: the page has unsaved work even though the
    // document itself is clean (nothing was typed).
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/d1/assets" && opts?.method === "POST"
        ? new Promise(() => {})
        : Promise.resolve({}),
    );
    const { push } = renderWorkspace();
    const surface = await findEditor();

    const image = new File(["png"], "anh.png", { type: "image/png" });
    const event = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", {
      value: { files: [image], getData: () => "" },
    });
    fireEvent(surface, event);

    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(([path]) => String(path) === "/api/v1/documents/d1/assets"),
      ).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
    expect(await screen.findByText(t("documents.leave.title"))).toBeInTheDocument();
    expect(push).not.toHaveBeenCalled();
  });

  it("still saves after a StrictMode remount", async () => {
    // React StrictMode runs mount -> cleanup -> mount in development. The
    // cleanup used to dispose the one save machine the hook memoises, so every
    // later edit was dropped and autosave was dead for the life of the screen.
    requestMock.mockImplementation((path: string, opts?: { method?: string }) =>
      path === "/api/v1/documents/d1" && opts?.method === "PATCH"
        ? Promise.resolve({ document: pageDocument({ revision: "4" }) })
        : Promise.resolve({}),
    );
    renderWorkspace({}, vi.fn(() => Promise.resolve({})), true);
    await findEditor();

    pasteText("StrictMode");

    await waitFor(() => expect(patchCalls()).toHaveLength(1), { timeout: 8_000 });
  });

  it("keeps a view-only page readable and out of the save loop", async () => {
    requestMock.mockResolvedValue({ document: pageDocument({ revision: "4" }) });
    renderWorkspace({ my_level: "view" });
    const surface = await findEditor();

    expect(surface).toHaveAttribute("contenteditable", "false");
    pasteText("không được sửa");
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(patchCalls()).toHaveLength(0);
    expect(screen.getByText(t("documents.save.readonly"))).toBeInTheDocument();
  });
});

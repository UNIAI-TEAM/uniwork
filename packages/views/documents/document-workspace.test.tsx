import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { NavigationProvider, type NavigationAdapter } from "../navigation";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentWorkspace } from "./document-workspace";

const { t } = initI18n();

const WS = "ws1";
const LIBRARY = "/acme/doi/documents";

function pageDocument(over: Record<string, unknown> = {}) {
  return {
    id: "d1",
    workspace_id: WS,
    kind: "page",
    title: "Kế hoạch Q3",
    content: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: "Nội dung A" }] }],
    },
    content_text: "Nội dung A",
    revision: "3",
    current_version: 1,
    my_level: "edit",
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  };
}

/** The editor arrives through React.lazy; the first TipTap import is slow. */
function findEditor() {
  return screen.findByRole("textbox", {}, { timeout: 15_000 });
}

/** Paste through the real ProseMirror handler, the way a user types text in. */
function pasteText(text: string) {
  const surface = screen.getByRole("textbox");
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", {
    value: { files: [], getData: (type: string) => (type === "text/plain" ? text : "") },
  });
  fireEvent(surface, event);
}

interface PatchCall {
  body: { revision?: string; content?: { content?: { content?: { text?: string }[] }[] } };
  headers?: Record<string, string>;
}

function patchCalls(): PatchCall[] {
  return requestMock.mock.calls
    .filter(([path, opts]) => String(path) === "/api/v1/documents/d1" && (opts as { method?: string })?.method === "PATCH")
    .map(([, opts]) => opts as PatchCall);
}

function renderWorkspace(over: Record<string, unknown> = {}, refetch = vi.fn(() => Promise.resolve({}))) {
  const push = vi.fn();
  const adapter: NavigationAdapter = {
    push,
    replace: vi.fn(),
    back: vi.fn(),
    pathname: "/acme/doi/documents/d1",
    searchParams: new URLSearchParams(),
    getShareableUrl: (path) => path,
  };
  const result = render(
    wrap(
      <NavigationProvider value={adapter}>
        <DocumentWorkspace
          wsId={WS}
          doc={pageDocument(over)}
          libraryHref={LIBRARY}
          refetch={refetch}
        />
      </NavigationProvider>,
    ),
  );
  return { push, refetch, ...result };
}

beforeEach(() => {
  requestMock.mockReset();
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
    renderWorkspace();
    await findEditor();

    pasteText("Bản của tôi");
    expect(await screen.findByText(t("documents.conflict.title"), {}, { timeout: 8_000 })).toBeInTheDocument();

    // Nothing is sent while the dialog is open.
    expect(patchCalls()).toHaveLength(1);

    // The option button carries its hint line too, so its accessible name
    // is the label plus the hint.
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("documents.conflict.keep_mine")) }));

    await waitFor(() => expect(patchCalls()).toHaveLength(2), { timeout: 8_000 });
    expect(patchCalls()[1]?.body.revision).toBe("9");
    await waitFor(() =>
      expect(screen.queryByText(t("documents.conflict.title"))).toBeNull(),
    );
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

  it("keeps a view-only page readable and out of the save loop", async () => {
    requestMock.mockResolvedValue({ document: pageDocument({ revision: "4" }) });
    renderWorkspace({ my_level: "view" });
    const surface = await findEditor();

    expect(surface).toHaveAttribute("contenteditable", "false");
    pasteText("không được sửa");
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(patchCalls()).toHaveLength(0);
    expect(screen.getByText(t("documents.detail.readonly_title"))).toBeInTheDocument();
  });
});

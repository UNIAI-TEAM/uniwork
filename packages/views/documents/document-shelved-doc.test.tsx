import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { ApiError } from "@uniwork/core/api";
import { FeatureFlagsProvider, FeatureFlagService, StaticProvider } from "@uniwork/core/feature-flags";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentDetailView } from "./document-detail-view";
import { VersionHistorySheet } from "./version-history-sheet";

// ARCHIVE-01 (UNI-1845) addendum §8 U-7 / U-10, tests UI-AR4 and UI-AR7: the
// document page of a shelved ("Lưu trữ") document is read-only everywhere, and
// a document_shelved answer to any write turns a live page read-only too. The
// transport is mocked, so the real schemas, hooks and i18n run.

const { t } = initI18n();

const WS = "ws1";
const LIBRARY = "/acme/doi/documents";
const SHELVED_AT = "2026-10-16T03:00:00Z";

function pageDocument(over: Record<string, unknown> = {}): Document {
  const parsed = DocumentSchema.parse({
    id: "d1",
    workspace_id: WS,
    organization_id: "org1",
    kind: "page",
    title: "Kế hoạch Q3",
    content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Nội dung A" }] }] },
    content_text: "Nội dung A",
    revision: "3",
    current_version: 1,
    my_level: "manage",
    created_at: "2026-09-28T03:00:00Z",
    updated_at: "2026-09-28T03:00:00Z",
    ...over,
  });
  return {
    ...parsed,
    kind: parsed.kind as Document["kind"],
    visibility: parsed.visibility as Document["visibility"],
    my_level: parsed.my_level as Document["my_level"],
    via: parsed.via as Document["via"],
    owner_kind: parsed.owner_kind as Document["owner_kind"],
    system_kind: parsed.system_kind as Document["system_kind"],
  };
}

const shelvedPage = (over: Record<string, unknown> = {}) =>
  pageDocument({ shelved_at: SHELVED_AT, shelved_by: "u9", ...over });

function withFlag(ui: React.ReactElement) {
  const service = new FeatureFlagService(new StaticProvider({ documents: { default: true } }));
  return wrapWithNav(<FeatureFlagsProvider service={service}>{ui}</FeatureFlagsProvider>);
}

function renderView() {
  return render(
    withFlag(<DocumentDetailView wsId={WS} documentId="d1" libraryHref={LIBRARY} onBackToList={vi.fn()} />),
  );
}

const findEditor = () => screen.findByRole("textbox", { name: t("documents.editor.aria_label") }, { timeout: 15_000 });

interface Served {
  calls: { method: string; path: string }[];
}

function serve(current: Document, handlers: Record<string, (init?: { method?: string; body?: unknown }) => unknown> = {}): Served {
  const served: Served = { calls: [] };
  requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
    const method = (init?.method ?? "GET").toUpperCase();
    served.calls.push({ method, path });
    const key = Object.keys(handlers).find((k) => k === `${method} ${path}` || (k.endsWith("*") && `${method} ${path}`.startsWith(k.slice(0, -1))));
    if (key) {
      const out = handlers[key]!(init);
      if (out instanceof Error) return Promise.reject(out);
      return Promise.resolve(out);
    }
    if (method === "GET" && path === "/api/v1/documents/d1") return Promise.resolve({ document: current });
    if (method === "GET" && path === "/api/v1/documents/d1/comments") {
      return Promise.resolve({ comments: [], mentions: [], list_token: "lt1:x" });
    }
    if (path.startsWith("/api/v1/orgs/")) return Promise.resolve({ favorites: [] });
    return Promise.resolve({});
  });
  return served;
}

beforeEach(() => {
  requestMock.mockReset();
  localStorage.clear();
  window.innerWidth = 1400;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UI-AR4 a shelved page opens read-only", () => {
  it("labels the title, states the read-only banner and keeps the editor, title and icon un-editable", async () => {
    serve(shelvedPage());
    renderView();

    const surface = await findEditor();
    expect(surface).toHaveAttribute("contenteditable", "false");
    expect(surface).toHaveTextContent("Nội dung A");
    // The title is plain text, not a field, and carries the "Archived" label beside it.
    expect(screen.queryByRole("textbox", { name: t("documents.page_ui.title_label") })).toBeNull();
    expect(screen.getByRole("heading", { level: 1, name: /Kế hoạch Q3/ })).toBeInTheDocument();
    expect(screen.getAllByText(t("documents.shelved_doc.label")).length).toBeGreaterThan(0);
    expect(screen.getByText(t("documents.shelved_doc.banner"))).toBeInTheDocument();
    // A shelved page is not the "you have view access" case: its own banner explains it.
    expect(screen.queryByText(t("documents.detail.readonly_description"))).toBeNull();
  });

  it("offers Unarchive to a manager only, and one click sends exactly one request", async () => {
    const gate: { release: (() => void) | null } = { release: null };
    const served = serve(shelvedPage(), {
      "POST /api/v1/documents/d1/unshelve": () =>
        new Promise<unknown>((resolve) => {
          gate.release = () => resolve({ document: pageDocument(), affected: ["d1"] });
        }),
    });
    const toastSuccess = vi.spyOn(toast, "success");
    renderView();
    await findEditor();

    const button = screen.getByRole("button", { name: t("documents.shelved_doc.unshelve") });
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(served.calls.filter((c) => c.path.endsWith("/unshelve"))).toHaveLength(1));
    expect(button).toHaveAttribute("aria-disabled", "true");
    gate.release?.();
    // The banner leaves with the shelved state; the confirmation still shows.
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith(t("documents.shelved_doc.unshelved", { title: "Kế hoạch Q3" })));
  });

  it("shows no Unarchive to a viewer or editor", async () => {
    serve(shelvedPage({ my_level: "edit" }));
    renderView();
    await findEditor();
    expect(screen.getByText(t("documents.shelved_doc.banner"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("documents.shelved_doc.unshelve") })).toBeNull();
  });

  it("shows Unarchive to a pure admin whose read carries admin_scope", async () => {
    serve(shelvedPage({ my_level: "view", admin_scope: true }));
    renderView();
    await findEditor();
    expect(screen.getByRole("button", { name: t("documents.shelved_doc.unshelve") })).toBeInTheDocument();
  });

  it("opens the comments panel read-only: no composer, a read-only status line", async () => {
    serve(shelvedPage());
    renderView();
    await findEditor();
    fireEvent.click(screen.getByRole("button", { name: t("documents.collab.collabDiscussion") }));

    expect(await screen.findByTestId("document-comments-pane")).toBeInTheDocument();
    expect(await screen.findByTestId("document-comments-status")).toHaveTextContent(
      t("documents.shelved_doc.comments_status"),
    );
    expect(screen.queryByTestId("document-discussion-composer")).toBeNull();
  });

  it("keeps version history readable and hides the restore and snapshot actions", async () => {
    serve(shelvedPage(), {
      "GET /api/v1/documents/d1/versions*": () => ({
        versions: [
          { id: "v2", document_id: "d1", version: 2, reason: "manual", created_at: "2026-10-01T03:00:00Z", created_by: "u1" },
          { id: "v1", document_id: "d1", version: 1, reason: "upload", created_at: "2026-09-28T03:00:00Z", created_by: "u1" },
        ],
      }),
    });
    render(
      withFlag(
        <VersionHistorySheet open onOpenChange={() => undefined} wsId={WS} doc={shelvedPage({ current_version: 2 })} />,
      ),
    );
    expect(await screen.findByText(t("documents.versions.title"))).toBeInTheDocument();
    // Both versions can still be opened, so the history is readable.
    expect(await screen.findAllByRole("button", { name: t("documents.versions.view") })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: t("documents.versions.restore", { no: 1 }) })).toBeNull();
    expect(screen.queryByLabelText(t("documents.versions.name_label"))).toBeNull();
  });
});

describe("UI-AR7 document_shelved from a write turns the page read-only", () => {
  const shelvedError = () =>
    new ApiError("document is shelved", "document_shelved", 409, undefined, undefined, "read_only");

  it("stops autosave, says it once, invalidates the document and keeps the unsaved text", async () => {
    const patches: string[] = [];
    let current = pageDocument({ my_level: "edit" });
    const served = serve(current, {
      "PATCH /api/v1/documents/d1": () => {
        patches.push("patch");
        // From the refusal on, the server reads the document as shelved.
        current = shelvedPage({ my_level: "edit" });
        return shelvedError();
      },
      "GET /api/v1/documents/d1": () => ({ document: current }),
    });
    const toastError = vi.spyOn(toast, "error");
    renderView();
    const surface = await findEditor();
    expect(surface).toHaveAttribute("contenteditable", "true");

    fireEvent.paste(surface, {
      clipboardData: { files: [], getData: (type: string) => (type === "text/plain" ? "Thêm" : "") },
    });
    // Autosave debounces two seconds, then the server answers 409 document_shelved.
    await waitFor(() => expect(patches).toHaveLength(1), { timeout: 8_000 });
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(t("documents.shelved_doc.write_blocked"), expect.anything()));

    // The detail is read again; the server now says the document is shelved.
    const detailGets = () => served.calls.filter((c) => c.method === "GET" && c.path === "/api/v1/documents/d1").length;
    await waitFor(() => expect(detailGets()).toBeGreaterThan(1));
    // Nothing retries on its own, however long the page stays open.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(patches).toHaveLength(1);
    // The text the user typed is still in the editor.
    expect(screen.getByRole("textbox", { name: t("documents.editor.aria_label") })).toHaveTextContent("Thêm");
    expect(toastError.mock.calls.filter(([message]) => message === t("documents.shelved_doc.write_blocked"))).toHaveLength(1);
  }, 20_000);

  it("turns the page read-only once the refetched document is shelved", async () => {
    const served = serve(pageDocument({ my_level: "edit" }), {
      "PATCH /api/v1/documents/d1": () => shelvedError(),
    });
    renderView();
    const surface = await findEditor();
    fireEvent.paste(surface, {
      clipboardData: { files: [], getData: (type: string) => (type === "text/plain" ? "B" : "") },
    });
    await waitFor(() => expect(served.calls.some((c) => c.method === "PATCH")).toBe(true), { timeout: 8_000 });
    // The refetch answers with the shelved document: the page flips to read-only.
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1") return Promise.resolve({ document: shelvedPage({ my_level: "edit" }) });
      if (path.endsWith("/comments")) return Promise.resolve({ comments: [], mentions: [], list_token: "lt1:x" });
      return Promise.resolve({});
    });
    await waitFor(() => expect(screen.getByText(t("documents.shelved_doc.banner"))).toBeInTheDocument(), { timeout: 8_000 });
    expect(screen.getByRole("textbox", { name: t("documents.editor.aria_label") })).toHaveAttribute("contenteditable", "false");
  }, 20_000);
  // RAR-07: the document was unshelved again before the refetch landed. The held draft is sent once more on
  // the same key, and the page leaves read-only when that save goes through.
  it("retries the held save once on the same key when the refetched document is no longer shelved", async () => {
    const keys: (string | undefined)[] = [];
    const bodies: unknown[] = [];
    serve(pageDocument({ my_level: "edit" }), {
      "PATCH /api/v1/documents/d1": (init) => {
        keys.push((init as { headers?: Record<string, string> } | undefined)?.headers?.["Idempotency-Key"]);
        bodies.push(init?.body);
        if (keys.length === 1) return shelvedError();
        return { document: pageDocument({ my_level: "edit", revision: "4", content_text: "Nội dung A Thêm" }) };
      },
    });
    renderView();
    const surface = await findEditor();
    fireEvent.paste(surface, {
      clipboardData: { files: [], getData: (type: string) => (type === "text/plain" ? "Thêm" : "") },
    });
    await waitFor(() => expect(keys).toHaveLength(2), { timeout: 10_000 });
    expect(keys[1]).toBe(keys[0]);
    expect(keys[0]).toBeTruthy();
    // The retry waits for the edit lock again: it carries the held lock id like the first send.
    expect(bodies[1]).toEqual(bodies[0]);
    expect(bodies[1]).toMatchObject({ edit_lock_id: expect.any(String) });
    await waitFor(() =>
      expect(screen.getByRole("textbox", { name: t("documents.editor.aria_label") })).toHaveAttribute("contenteditable", "true"),
    );
    expect(screen.queryByText(t("documents.shelved_doc.banner"))).toBeNull();
    // Once, not a loop: nothing more is sent.
    await new Promise((resolve) => setTimeout(resolve, 2_500));
    expect(keys).toHaveLength(2);
  }, 25_000);
});

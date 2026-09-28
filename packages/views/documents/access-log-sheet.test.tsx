import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { DocumentSchema, type Document } from "@uniwork/core/types/document";
import { requestMock, wrap } from "../test/api-mock";
import { AccessLogSheet } from "./access-log-sheet";

const { t } = initI18n();
const WS = "ws1";

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
      kind: "page",
      title: "Kế hoạch Q4",
      revision: "7",
      my_level: "manage",
      ...over,
    }),
  );
}

const rows = [
  {
    id: "g1",
    action: "view",
    via: "member",
    version: 2,
    actor_kind: "human",
    actor_id: "u2",
    actor: { id: "u2", kind: "human", display_name: "Bình" },
    occurred_at: "2026-09-28T03:00:00Z",
  },
  {
    id: "g2",
    action: "link_view",
    via: "link",
    actor_kind: "anonymous",
    occurred_at: "2026-09-27T03:00:00Z",
  },
  {
    id: "g3",
    action: "download",
    via: "share",
    actor_kind: "human",
    actor_id: "u9",
    occurred_at: "2026-09-26T03:00:00Z",
  },
];

function serve(over: { logs?: unknown[]; next?: string | null } = {}) {
  requestMock.mockReset();
  requestMock.mockImplementation((path: string, opts?: { method?: string }) => {
    if (path.startsWith("/api/v1/documents/d1/access-logs")) {
      const filtered = String(path).includes("action=download")
        ? rows.filter((r) => r.action === "download")
        : (over.logs ?? rows);
      return Promise.resolve({ logs: filtered, next_cursor: over.next ?? null });
    }
    return Promise.resolve({});
  });
}

function renderSheet(over: { doc?: Document; onOpenChange?: (open: boolean) => void } = {}) {
  const onOpenChange = over.onOpenChange ?? vi.fn();
  return render(
    wrap(
      <AccessLogSheet
        open
        onOpenChange={onOpenChange}
        wsId={WS}
        doc={over.doc ?? documentFixture()}
      />,
    ),
  );
}

beforeEach(() => {
  serve();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("AccessLogSheet", () => {
  it("lists who did what, naming people and marking anonymous rows", async () => {
    renderSheet();

    expect(await screen.findByText("Bình")).toBeInTheDocument();
    expect(screen.getByText(t("documents.accessLog.actor_anonymous"))).toBeInTheDocument();
    // A human without a resolved actor block is not shown as a person.
    expect(screen.getAllByText(t("documents.accessLog.actor_unknown")).length).toBe(1);
    expect(screen.getByText(t("documents.accessLog.action_link_view"))).toBeInTheDocument();
    expect(screen.getByText(new RegExp(t("documents.accessLog.version", { no: 2 })))).toBeInTheDocument();
    // The request is the manage-only endpoint.
    expect(
      requestMock.mock.calls.some(([p]) => String(p).startsWith("/api/v1/documents/d1/access-logs")),
    ).toBe(true);
  });

  it("filters by action through the server", async () => {
    renderSheet();
    await screen.findByText("Bình");

    fireEvent.click(screen.getByRole("combobox", { name: t("documents.accessLog.filter_label") }));
    const option = await screen.findByRole("option", {
      name: t("documents.accessLog.action_download"),
    });
    // Base UI's select commits on a pointer press, not on a bare click.
    fireEvent.pointerDown(option, { pointerType: "mouse" });
    fireEvent.pointerUp(option, { pointerType: "mouse" });
    fireEvent.click(option);

    await waitFor(() =>
      expect(screen.getByRole("combobox", { name: t("documents.accessLog.filter_label") })).toHaveTextContent(
        t("documents.accessLog.action_download"),
      ),
    );
    await waitFor(() =>
      expect(
        requestMock.mock.calls.some(([p]) => String(p).includes("action=download")),
      ).toBe(true),
    );
  });

  it("shows an honest empty state", async () => {
    serve({ logs: [] });
    renderSheet();

    expect(await screen.findByText(t("documents.accessLog.empty"))).toBeInTheDocument();
  });

  it("keeps a failed read with a retry", async () => {
    let fail = true;
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/documents/d1/access-logs")) {
        if (fail) return Promise.reject(new Error("offline"));
        return Promise.resolve({ logs: rows, next_cursor: null });
      }
      return Promise.resolve({});
    });
    renderSheet();

    expect(await screen.findByText(t("documents.accessLog.error"))).toBeInTheDocument();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: t("documents.accessLog.retry") }));
    expect(await screen.findByText("Bình")).toBeInTheDocument();
  });

  it("loads the next page when the server has one", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/documents/d1/access-logs")) {
        const more = String(path).includes("cursor=");
        return Promise.resolve({
          logs: more ? [rows[2]] : rows,
          next_cursor: more ? null : "cursor-1",
        });
      }
      return Promise.resolve({});
    });
    renderSheet();

    const more = await screen.findByRole("button", { name: t("documents.accessLog.load_more") });
    fireEvent.click(more);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: t("documents.accessLog.load_more") })).toBeNull(),
    );
  });

  it("explains the manage-only rule when the level drops while open", async () => {
    const { rerender } = renderSheet();
    await screen.findByText("Bình");

    rerender(
      wrap(
        <AccessLogSheet
          open
          onOpenChange={() => undefined}
          wsId={WS}
          doc={documentFixture({ my_level: "edit" })}
        />,
      ),
    );

    expect(screen.getByText(t("documents.accessLog.manage_only"))).toBeInTheDocument();
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  it("holds focus inside while open and closes on Escape", async () => {
    const onOpenChange = vi.fn();
    renderSheet({ onOpenChange });
    const dialog = await screen.findByRole("dialog", { name: t("documents.accessLog.title") });
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    fireEvent.keyDown(document.activeElement ?? dialog, { key: "Escape" });
    await waitFor(() => expect(onOpenChange.mock.calls.some((call) => call[0] === false)).toBe(true));
  });
});

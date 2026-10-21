import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { NOTIFICATION_KINDS, type Notification, type User, type Workspace } from "@uniwork/core/types";
import { MODULE_ICONS } from "../layout/module-icons";
import { moduleTone } from "../layout/module-tones";
import { WorkspaceProvider } from "../layout/workspace-context";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { InboxView } from "./inbox-view";
import { kindIcon } from "./kind-icon";
import { kindTone } from "./kind-tone";
import { inboxCategory } from "./notification-category";
import { NotificationRow } from "./notification-row";
import { notificationSnippet } from "./notification-snippet";
import { NotificationTitle, notificationTitleKey } from "./notification-title";
import { resourceHref } from "./resource-href";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// UNI-2056 (DOC-CHANGE-NOTIFY): the web renders the folded `document_changed` row from the wire
// shape of u2056-web-core-shape-proposal.md P1: every param a string, the sample titles already
// filtered to what the reader can read.

initI18n();

const user: User = {
  id: "u1", email: "a@b.c", display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z", email_verified_at: "2026-08-25T00:00:00Z", onboarding_questionnaire: {}, locale: "vi",
};
const workspace: Workspace = {
  id: "ws1", slug: "team", name: "Team", organization_id: "o1", organization_slug: "acme", organization_name: "Acme",
};

// Test shorthand: sample_title_1..3 build the row's top-level `sample_documents` (AMENDMENT 1: the wire
// carries no titles in params); a key that is left out is a sample the reader cannot read.
const changed = (shorthand: Record<string, string> = {}, over: Partial<Notification> = {}): Notification => {
  const { sample_title_1, sample_title_2, sample_title_3, ...params } = { sample_title_1: "Kế hoạch Q4", ...shorthand };
  const sample_documents = [sample_title_1, sample_title_2, sample_title_3]
    .map((title, i) => (title === undefined ? null : { id: `d${i + 1}`, title }))
    .filter((d): d is { id: string; title: string } => d !== null);
  return {
    id: "n1", kind: "document_changed", workspace_id: "ws1", organization_id: "o1", resource_type: "document",
    resource_id: "d1", resource_deleted: false, resource_access_lost: false, comment_deleted: false, actor_kind: "human",
    actor_id: "u2", title_key: "notifications.kind.document_changed", count: 1, created_at: "2026-10-21T03:00:00Z",
    params: { actor: "An", verb: "renamed", document_count: "1", sample_document_ids: "d1", ...params },
    sample_documents,
    ...over,
  };
};

const sentence = (n: Notification, unread = false) => {
  const { container, unmount } = render(<NotificationTitle notification={n} unread={unread} />);
  const text = container.textContent ?? "";
  unmount();
  return text;
};

function row(n: Notification, props: Partial<React.ComponentProps<typeof NotificationRow>> = {}) {
  const nav = {
    push: vi.fn(), replace: vi.fn(), back: vi.fn(),
    pathname: "/acme/team/inbox", searchParams: new URLSearchParams(), getShareableUrl: (p: string) => p,
  };
  const view = render(
    wrapWithNav(
      <WorkspaceProvider workspace={workspace} user={user}>
        <ul><NotificationRow notification={n} href={resourceHref(n, workspace, [workspace])} onOpen={() => undefined} {...props} /></ul>
      </WorkspaceProvider>,
      nav,
    ),
  );
  return { nav, ...view };
}

beforeEach(async () => {
  requestMock.mockReset();
  await setLocale("vi");
});
afterEach(async () => {
  cleanup();
  await setLocale("vi");
});

describe("document_changed kind registry (item 5)", () => {
  it("is a known kind with the documents glyph, the documents tone and the updates category", () => {
    expect(NOTIFICATION_KINDS).toContain("document_changed");
    expect(kindIcon("document_changed")).toBe(MODULE_ICONS.documents);
    expect(kindIcon("document_changed")).not.toBe(kindIcon("kind_from_a_newer_server"));
    expect(kindTone("document_changed")).toBe(moduleTone("documents"));
    expect(inboxCategory("document_changed")).toBe("updates");
  });
});

// [verb, vi one-document sentence, vi several, en one-document, en several]
const VERBS: [string, string, string, string, string][] = [
  ["renamed", "An đã đổi tên tài liệu “Kế hoạch Q4”", "An đã đổi tên 5 tài liệu", "An renamed “Kế hoạch Q4”", "An renamed 5 documents"],
  ["moved", "An đã di chuyển tài liệu “Kế hoạch Q4”", "An đã di chuyển 5 tài liệu", "An moved “Kế hoạch Q4”", "An moved 5 documents"],
  ["trashed", "An đã chuyển tài liệu “Kế hoạch Q4” vào thùng rác", "An đã chuyển 5 tài liệu vào thùng rác", "An moved “Kế hoạch Q4” to trash", "An moved 5 documents to trash"],
  ["restored", "An đã khôi phục tài liệu “Kế hoạch Q4”", "An đã khôi phục 5 tài liệu", "An restored “Kế hoạch Q4”", "An restored 5 documents"],
  ["deleted", "An đã xóa vĩnh viễn tài liệu “Kế hoạch Q4”", "An đã xóa vĩnh viễn 5 tài liệu", "An permanently deleted “Kế hoạch Q4”", "An permanently deleted 5 documents"],
  ["shelved", "An đã lưu trữ tài liệu “Kế hoạch Q4”", "An đã lưu trữ 5 tài liệu", "An archived “Kế hoạch Q4”", "An archived 5 documents"],
  ["unshelved", "An đã bỏ lưu trữ tài liệu “Kế hoạch Q4”", "An đã bỏ lưu trữ 5 tài liệu", "An unarchived “Kế hoạch Q4”", "An unarchived 5 documents"],
  ["access_changed", "An đã đổi quyền truy cập của tài liệu “Kế hoạch Q4”", "An đã đổi quyền truy cập của 5 tài liệu", "An changed access to “Kế hoạch Q4”", "An changed access to 5 documents"],
  ["version_created", "An đã tạo phiên bản mới cho tài liệu “Kế hoạch Q4”", "An đã tạo phiên bản mới cho 5 tài liệu", "An added a new version to “Kế hoạch Q4”", "An added a new version to 5 documents"],
  [
    "relocated",
    "An đã chuyển thư mục chứa tài liệu “Kế hoạch Q4” của bạn vào thùng rác; tài liệu được đưa về gốc workspace",
    "An đã chuyển thư mục chứa 5 tài liệu của bạn vào thùng rác; các tài liệu được đưa về gốc workspace",
    "An moved the folder holding “Kế hoạch Q4” to trash; the document is now at the workspace root",
    "An moved the folder holding 5 of your documents to trash; the documents are now at the workspace root",
  ],
];

describe("document_changed sentence per verb (item 1)", () => {
  it.each(VERBS)("%s reads in vi and en, for one document and for several", async (verb, viOne, viMany, enOne, enMany) => {
    const one = changed({ verb });
    const many = changed({ verb, document_count: "5", sample_title_2: "Hợp đồng" }, { count: 5 });
    expect(sentence(one)).toBe(viOne);
    expect(sentence(many)).toBe(viMany);
    await setLocale("en");
    expect(sentence(one)).toBe(enOne);
    expect(sentence(many)).toBe(enMany);
  });

  it("says one unnamed document when no title is readable, never an id or a bare placeholder", async () => {
    const n = changed({ verb: "moved", sample_title_1: "", sample_document_ids: "01J0ABCDEFGHJKMNPQRSTVWXYZ" });
    expect(notificationTitleKey(n)).toBe("notifications.kind.document_changed_moved_untitled");
    expect(sentence(n)).toBe("An đã di chuyển một tài liệu");
    await setLocale("en");
    expect(sentence(n)).toBe("An moved a document");
    expect(sentence(n)).not.toMatch(/01J0|\{\{|notifications\.kind/);
  });

  it("falls back to the generic sentence for a verb it does not know or one that is missing", async () => {
    for (const params of [{ verb: "teleported" }, { verb: "" }]) {
      expect(sentence(changed({ ...params, document_count: "7" }, { count: 7 }))).toBe("An đã thay đổi 7 tài liệu");
      expect(sentence(changed(params))).toBe("An đã thay đổi tài liệu “Kế hoạch Q4”");
    }
    const noVerb = changed({ document_count: "7" }, { count: 7 });
    delete noVerb.params.verb;
    expect(sentence(noVerb)).toBe("An đã thay đổi 7 tài liệu");
    await setLocale("en");
    expect(sentence(noVerb)).toBe("An changed 7 documents");
  });

  it("takes the number from document_count, then the row's count, then the titles in hand (at least one)", () => {
    const trashed = { verb: "trashed", sample_title_2: "B", sample_title_3: "C" };
    expect(sentence(changed({ ...trashed, document_count: "12" }, { count: 4 }))).toBe("An đã chuyển 12 tài liệu vào thùng rác");
    expect(sentence(changed({ ...trashed, document_count: "many" }, { count: 4 }))).toBe("An đã chuyển 4 tài liệu vào thùng rác");
    const noParam = changed(trashed, { count: 4 });
    delete noParam.params.document_count;
    expect(sentence(noParam)).toBe("An đã chuyển 4 tài liệu vào thùng rác");
    expect(sentence(changed({ ...trashed, document_count: "0" }, { count: 0 }))).toBe("An đã chuyển 3 tài liệu vào thùng rác");
    expect(sentence(changed({ verb: "trashed", document_count: "", sample_title_1: "" }, { count: 0 }))).toBe(
      "An đã chuyển một tài liệu vào thùng rác",
    );
  });

  it("takes the titles from sample_documents only: a title in params is never read", () => {
    const n = changed({ verb: "moved" });
    n.params.sample_title_1 = "Từ params";
    n.sample_documents = [];
    expect(sentence(n)).toBe("An đã di chuyển một tài liệu");
    n.sample_documents = undefined;
    expect(sentence(n)).toBe("An đã di chuyển một tài liệu");
  });

  it("emphasises the actor like the other kinds and the one document's name", () => {
    const { container } = render(<NotificationTitle notification={changed()} unread />);
    const strong = Array.from(container.querySelectorAll("span")).map((s) => [s.textContent, s.className]);
    expect(strong.find(([text]) => text === "An")?.[1]).toContain("font-semibold");
    expect(strong.find(([text]) => text === "Kế hoạch Q4")?.[1]).toContain("font-medium");
  });

  it("badges an agent actor", () => {
    const { container } = render(<NotificationTitle notification={changed({}, { actor_kind: "agent" })} unread={false} />);
    expect(container).toHaveTextContent("An");
    expect(container).toHaveTextContent("Agent");
  });
});

describe("document_changed snippet (item 2)", () => {
  const snippet = (params: Record<string, string>) => notificationSnippet(changed(params));

  it("lists up to three sample titles and counts the rest", () => {
    expect(snippet({ document_count: "50", sample_title_2: "B", sample_title_3: "C" })).toEqual({
      kind: "documents", titles: ["Kế hoạch Q4", "B", "C"], more: 47,
    });
    expect(snippet({ document_count: "2", sample_title_2: "B" })).toEqual({ kind: "documents", titles: ["Kế hoạch Q4", "B"], more: 0 });
  });

  it("skips a missing or blank sample key without leaving a gap", () => {
    expect(snippet({ document_count: "9", sample_title_2: "  ", sample_title_3: "C" })).toEqual({
      kind: "documents", titles: ["Kế hoạch Q4", "C"], more: 7,
    });
    expect(snippet({ document_count: "9", sample_title_1: "", sample_title_3: "C" })).toEqual({
      kind: "documents", titles: ["C"], more: 8,
    });
  });

  it("falls back to the row's count when document_count is garbage, and never owes a negative rest", () => {
    expect(notificationSnippet(changed({ document_count: "lots", sample_title_2: "B" }, { count: 6 }))).toEqual({
      kind: "documents", titles: ["Kế hoạch Q4", "B"], more: 4,
    });
    expect(snippet({ document_count: "lots", sample_title_2: "B" })).toEqual({ kind: "documents", titles: ["Kế hoạch Q4", "B"], more: 0 });
    expect(snippet({ document_count: "1", sample_title_2: "B" })).toEqual({ kind: "documents", titles: ["Kế hoạch Q4", "B"], more: 0 });
  });

  it("has no line when no title is readable: the sentence already carries the count, and ids never show", () => {
    expect(snippet({ document_count: "5", sample_title_1: "", sample_document_ids: "d1,d2,d3" })).toBeNull();
    const { container } = row(changed({ document_count: "5", sample_title_1: "", sample_document_ids: "d1,d2,d3" }, { count: 5 }));
    expect(container.querySelector("[data-notification-snippet]")).toBeNull();
    expect(container).not.toHaveTextContent(/d1|d2|d3/);
  });

  it("is not hidden by the row's access flags: the server already filtered the titles", () => {
    const n = changed({ document_count: "3", sample_title_2: "B" }, { resource_access_lost: true, resource_deleted: true });
    expect(notificationSnippet(n)).toEqual({ kind: "documents", titles: ["Kế hoạch Q4", "B"], more: 1 });
  });

  it("renders the titles quoted, then 'và M tài liệu khác' / 'and M more' that never shrinks", async () => {
    const n = changed({ verb: "trashed", document_count: "50", sample_title_2: "B", sample_title_3: "C" }, { count: 50 });
    const { container } = row(n);
    const line = container.querySelector("[data-notification-snippet]");
    expect(line).toHaveTextContent("“Kế hoạch Q4”, “B”, “C” và 47 tài liệu khác");
    const [titles, more] = Array.from(line?.children ?? []);
    expect(titles?.className).toContain("truncate");
    expect(more?.className).toContain("shrink-0");
    cleanup();
    await setLocale("en");
    expect(row(n).container.querySelector("[data-notification-snippet]")).toHaveTextContent("“Kế hoạch Q4”, “B”, “C” and 47 more");
  });
});

describe("document_changed row folds in place (item 3)", () => {
  it("shows no 'và N thay đổi khác' suffix: the fold count is the document count", () => {
    const { container } = row(changed({ verb: "moved", document_count: "50" }, { count: 50 }));
    expect(container).not.toHaveTextContent(/thay đổi khác/);
    expect(container).toHaveTextContent("An đã di chuyển 50 tài liệu");
    // ...while any other kind keeps its suffix.
    cleanup();
    const other = row(changed({}, { kind: "document_shared", count: 4, title_key: "notifications.kind.document_shared" }));
    expect(other.container).toHaveTextContent("và 3 thay đổi khác");
  });

  it("re-renders new params after a refetch: the count and the titles move, no new row", () => {
    const first = changed({ verb: "moved", document_count: "2", sample_title_2: "B" }, { count: 2 });
    const view = row(first);
    expect(view.container).toHaveTextContent("An đã di chuyển 2 tài liệu");
    const next = changed({ verb: "moved", document_count: "3", sample_title_2: "B", sample_title_3: "C" }, { count: 3 });
    view.rerender(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <ul><NotificationRow notification={next} href="/x" onOpen={() => undefined} /></ul>
        </WorkspaceProvider>,
      ),
    );
    expect(view.container).toHaveTextContent("An đã di chuyển 3 tài liệu");
    expect(view.container).toHaveTextContent("“Kế hoạch Q4”, “B”, “C”");
    expect(view.container.querySelectorAll("li")).toHaveLength(1);
  });
});

describe("document_changed click target (item 4)", () => {
  const other = { id: "ws2", slug: "sales", organization_id: "o1", organization_slug: "acme" } as Workspace;

  it("opens the one document, in its own workspace when the reader belongs to it", () => {
    expect(resourceHref(changed(), workspace, [workspace])).toBe("/acme/team/documents/d1");
    expect(resourceHref(changed({}, { workspace_id: "ws2" }), workspace, [workspace, other])).toBe("/acme/sales/documents/d1");
  });

  it("opens the Thùng rác with the document focused for the trashed verb, like document_trashed_by_other", () => {
    expect(resourceHref(changed({ verb: "trashed" }), workspace, [workspace])).toBe("/acme/team/documents?view=archived&focus=d1");
  });

  it("is no link at all for one permanently deleted document", () => {
    const { container } = row(changed({ verb: "deleted" }));
    expect(screen.queryByRole("link")).toBeNull();
    expect(container).toHaveTextContent("An đã xóa vĩnh viễn tài liệu “Kế hoạch Q4”");
    expect(container.querySelector("[data-row-focus]")).toBeNull();
  });

  it("keeps a permanently deleted several-document row clickable: it opens the list", () => {
    const onOpenList = vi.fn();
    row(changed({ verb: "deleted", document_count: "3" }, { count: 3 }), { onOpenList });
    expect(screen.getByRole("link")).toBeInTheDocument();
  });

  it("opens the list instead of navigating when the host has one, and marks the row read", () => {
    const onOpen = vi.fn();
    const onOpenList = vi.fn();
    const n = changed({ verb: "moved", document_count: "50" }, { count: 50 });
    const { nav } = row(n, { onOpen, onOpenList });
    fireEvent.click(screen.getByRole("link"));
    expect(onOpen).toHaveBeenCalledWith(n);
    expect(onOpenList).toHaveBeenCalledWith(n);
    expect(nav.push).not.toHaveBeenCalled();
  });

  it("offers a visible 'Xem 50 tài liệu' action that opens the same list", async () => {
    const onOpenList = vi.fn();
    const n = changed({ verb: "moved", document_count: "50" }, { count: 50 });
    row(n, { onOpenList });
    fireEvent.click(screen.getByRole("button", { name: "Xem 50 tài liệu" }));
    expect(onOpenList).toHaveBeenCalledWith(n);
    cleanup();
    await setLocale("en");
    row(n, { onOpenList });
    expect(screen.getByRole("button", { name: "View 50 documents" })).toBeInTheDocument();
  });

  it("has no list action for one document, nor where the host has no list (the bell lands in the Inbox)", () => {
    row(changed());
    expect(screen.queryByRole("button")).toBeNull();
    cleanup();
    const many = changed({ verb: "moved", document_count: "50" }, { count: 50 });
    row(many);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/acme/team/inbox");
  });
});

describe("document_changed list dialog in the Inbox (item 4)", () => {
  const doc = (id: string, over: Record<string, unknown> = {}) => ({
    id, title: `Tài liệu ${id}`, kind: "page", trashed: false, shelved: false, deleted: false, ...over,
  });
  const foldedRow = changed({ verb: "trashed", document_count: "50", sample_title_2: "Hợp đồng" }, { count: 50 });

  function mockApi(documents: (path: string) => unknown) {
    requestMock.mockImplementation((path: string) => {
      if (path.startsWith("/api/v1/me/notifications/unread-count")) return Promise.resolve({ total: 1, by_workspace: { ws1: 1 } });
      if (path.includes("/documents")) {
        const out = documents(path);
        return out instanceof Error ? Promise.reject(out) : Promise.resolve(out);
      }
      if (path.startsWith("/api/v1/me/notifications?")) return Promise.resolve({ notifications: [foldedRow], next_before: "" });
      return Promise.resolve({ status: "ok" });
    });
  }

  function renderInbox() {
    const nav = {
      push: vi.fn(), replace: vi.fn(), back: vi.fn(),
      pathname: "/acme/team/inbox", searchParams: new URLSearchParams(), getShareableUrl: (p: string) => p,
    };
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <InboxView />
        </WorkspaceProvider>,
        nav,
      ),
    );
    return nav;
  }

  const openList = async () => {
    fireEvent.click(await screen.findByRole("link", { name: /đã chuyển 50 tài liệu vào thùng rác/ }));
    return screen.findByRole("dialog", { name: "Tài liệu thay đổi" });
  };

  it("lists the affected documents: each links to its document, an archived one to its trash view, a deleted one is muted text", async () => {
    mockApi(() => ({
      documents: [
        doc("d1"),
        doc("d2", { trashed: true }),
        doc("d3", { deleted: true, title: "", kind: "" }),
        doc("d4", { shelved: true }),
      ],
      next_cursor: null,
    }));
    const nav = renderInbox();
    const dialog = await openList();
    // The row click marked the row read and opened the dialog; it did not navigate.
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/read", expect.objectContaining({ body: { ids: ["n1"] } })),
    );
    expect(nav.push).not.toHaveBeenCalled();
    expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/n1/documents", expect.anything());
    const items = await within(dialog).findAllByRole("listitem");
    expect(items).toHaveLength(4);
    expect(within(dialog).getByRole("link", { name: /Tài liệu d1/ })).toHaveAttribute("href", "/acme/team/documents/d1");
    const archived = within(dialog).getByRole("link", { name: /Tài liệu d2/ });
    expect(archived).toHaveAttribute("href", "/acme/team/documents?view=archived&focus=d2");
    expect(archived).toHaveTextContent("Trong thùng rác");
    // A shelved document opens as itself; the list links with the notification row's workspace.
    expect(within(dialog).getByRole("link", { name: /Tài liệu d4/ })).toHaveAttribute("href", "/acme/team/documents/d4");
    expect(items[2]).toHaveTextContent("Đã xóa vĩnh viễn");
    expect(within(items[2]!).queryByRole("link")).toBeNull();
    expect(within(dialog).getAllByRole("link")).toHaveLength(3);
  });

  it("pages with 'Xem thêm' until there is no next cursor", async () => {
    mockApi((path) =>
      path.includes("cursor=c2")
        ? { documents: [doc("d3")], next_cursor: null }
        : { documents: [doc("d1"), doc("d2")], next_cursor: "c2" },
    );
    renderInbox();
    const dialog = await openList();
    expect(await within(dialog).findByText("Tài liệu d2")).toBeInTheDocument();
    expect(within(dialog).queryByText("Tài liệu d3")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Xem thêm" }));
    expect(await within(dialog).findByText("Tài liệu d3")).toBeInTheDocument();
    expect(requestMock).toHaveBeenCalledWith("/api/v1/me/notifications/n1/documents?cursor=c2", expect.anything());
    expect(within(dialog).queryByRole("button", { name: "Xem thêm" })).toBeNull();
  });

  it("says it is loading while the first page is on its way", async () => {
    mockApi(() => new Promise(() => undefined));
    renderInbox();
    const dialog = await openList();
    expect(await within(dialog).findByRole("status")).toHaveTextContent("Đang tải danh sách tài liệu");
  });

  it("says truthfully that nothing is left to read, with no mock rows", async () => {
    mockApi(() => ({ documents: [], next_cursor: null }));
    renderInbox();
    const dialog = await openList();
    expect(await within(dialog).findByText("Không còn tài liệu nào bạn đọc được")).toBeInTheDocument();
    expect(within(dialog).queryByRole("listitem")).toBeNull();
  });

  it("says the list failed and retries on demand", async () => {
    let fail = true;
    mockApi(() => (fail ? new Error("boom") : { documents: [doc("d1")], next_cursor: null }));
    renderInbox();
    const dialog = await openList();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("Không tải được danh sách tài liệu");
    fail = false;
    fireEvent.click(within(dialog).getByRole("button", { name: "Thử lại" }));
    expect(await within(dialog).findByText("Tài liệu d1")).toBeInTheDocument();
  });

  it("closes from the close button and again from the same row", async () => {
    mockApi(() => ({ documents: [doc("d1")], next_cursor: null }));
    renderInbox();
    const dialog = await openList();
    fireEvent.click(within(dialog).getByRole("button", { name: "Đóng" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(await openList()).toBeInTheDocument();
  });
});

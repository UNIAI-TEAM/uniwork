import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useEffect, type ReactNode } from "react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { initI18n } from "@uniwork/core/i18n";
import {
  configureShortcutPlatform,
  createShortcutChord,
  getShortcut,
  useShortcutStore,
} from "@uniwork/core/shortcuts";
import { useTaskDetailUiStore } from "@uniwork/core/tasks/stores/task-detail-ui-store";
import type { User, Workspace } from "@uniwork/core/types";
import { GlobalShortcuts } from "../../../layout/global-shortcuts";
import { WorkspaceProvider } from "../../../layout/workspace-context";
import { requestMock, wrapWithNav } from "../../../test/api-mock";
import { TaskDetailSuitePage } from "../task-detail-suite-page";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

const me: User = {
  id: "u1",
  email: "me@x.com",
  display_name: "Me",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

const workspace: Workspace = {
  id: "w1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "org",
  organization_name: "Org",
};

function taskFixture(id: string, title: string, description: string) {
  return {
    id,
    organization_id: "o1",
    workspace_id: "w1",
    number: 12,
    identifier: `TEAM-${id}`,
    revision: 3,
    title,
    description,
    status: "todo",
    priority: "medium",
    position: 1,
    created_by: "u1",
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-01T00:00:00Z",
  };
}

const tasks: Record<string, ReturnType<typeof taskFixture>> = {
  t1: taskFixture("t1", "Ship detail shell", "TipTap title and body"),
  t2: taskFixture("t2", "Second task", "Another body"),
};

type CommentFixture = {
  id: string;
  body: string;
  at: string;
  parent_id?: string;
  resolved?: boolean;
};

let comments: CommentFixture[] = [];

function commentsResponse() {
  return {
    comments: comments.map(({ id, body, at, parent_id, resolved }) => ({
      id,
      task_id: "t1",
      author_id: "u1",
      author_kind: "human",
      body,
      parent_id,
      type: "comment",
      revision: 0,
      created_at: `2026-09-12T10:${at}:00Z`,
      resolved_at: resolved ? "2026-09-12T11:00:00Z" : undefined,
      reactions: [],
    })),
  };
}

const FIND_LABEL = /tìm trong công việc|find in task/i;
const THREAD_NAV = /điều hướng luồng|thread navigation/i;

function shell(ui: ReactNode) {
  return wrapWithNav(
    <WorkspaceProvider workspace={workspace} user={me}>
      {ui}
    </WorkspaceProvider>,
  );
}

async function renderPage(outside?: ReactNode) {
  const view = render(
    shell(
      <>
        {outside}
        <TaskDetailSuitePage workspaceId="w1" taskId="t1" />
      </>,
    ),
  );
  await screen.findByText("Ship detail shell");
  return view;
}

/** `false` when a listener called preventDefault (the browser's own find is suppressed). */
function pressFind(target: Element = document.body) {
  return fireEvent.keyDown(target, { key: "f", metaKey: true });
}

async function openFind(): Promise<HTMLElement> {
  expect(pressFind()).toBe(false);
  const input = await screen.findByRole("textbox", { name: FIND_LABEL });
  await waitFor(() => expect(input).toHaveFocus());
  return input;
}

function findCount(): HTMLElement {
  return within(screen.getByRole("search")).getByTestId("task-find-count");
}

function descriptionSurface(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = Array.from(
      document.querySelectorAll<HTMLElement>(".ProseMirror[contenteditable='true']"),
    ).find((node) => node.textContent?.includes("TipTap title and body"));
    expect(el).toBeTruthy();
    return el as HTMLElement;
  });
}

const emptyRect = {
  x: 0, y: 0, top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, toJSON: () => ({}),
};
const originalElementRects = Element.prototype.getClientRects;

/**
 * jsdom lays nothing out: every element answers `getClientRects()` with an
 * empty list, which the page's visibility gate reads as "not rendered", so
 * ⌘F would silently do nothing in every test. Replace it with the one
 * browser rule the gate relies on: a connected element outside any `[hidden]`
 * subtree has a box. A page mounted under `<div hidden>` then reads as
 * invisible, the way `display: none` does in a browser.
 */
function stubLayout() {
  Element.prototype.getClientRects = function getClientRects(this: Element) {
    const rendered = this.isConnected && this.closest("[hidden]") === null;
    return (rendered ? [emptyRect] : []) as unknown as DOMRectList;
  };
  // jsdom has no Range geometry at all; a zero-size rect makes
  // scroll-to-match a no-op.
  Range.prototype.getClientRects = () => [emptyRect] as unknown as DOMRectList;
  Range.prototype.getBoundingClientRect = () => emptyRect;
}

function restoreLayout() {
  Element.prototype.getClientRects = originalElementRects;
  delete (Range.prototype as { getClientRects?: unknown }).getClientRects;
  delete (Range.prototype as { getBoundingClientRect?: unknown }).getBoundingClientRect;
}

beforeAll(() => {
  initI18n();
});

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  configureShortcutPlatform("macos");
  useShortcutStore.getState().resetAll();
  useTaskDetailUiStore.setState({ tasks: {} });
  window.history.replaceState(null, "", "/");
  comments = [];
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    const taskId = /^\/api\/v1\/tasks\/([^/]+)$/.exec(p)?.[1];
    if (taskId && tasks[taskId]) return Promise.resolve({ task: tasks[taskId] });
    if (p === "/api/v1/tasks/t1/comments") return Promise.resolve(commentsResponse());
    return Promise.resolve({});
  });
  stubLayout();
});

afterEach(() => {
  restoreLayout();
  useShortcutStore.getState().resetAll();
  configureShortcutPlatform(null);
});

describe("tìm trong trang chi tiết task", () => {
  it("⌘F trên trang chi tiết mở thanh tìm và đưa focus vào ô nhập", async () => {
    await renderPage();
    // A held key auto-repeats; only a fresh press counts.
    expect(fireEvent.keyDown(document.body, { key: "f", metaKey: true, repeat: true })).toBe(true);
    expect(screen.queryByRole("search")).toBeNull();

    await openFind();

    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("⌘F khi trang chi tiết không hiển thị thì không làm gì, để trình duyệt tự tìm", async () => {
    const { container } = render(
      shell(
        <div hidden>
          <TaskDetailSuitePage workspaceId="w1" taskId="t1" />
        </div>,
      ),
    );
    await screen.findByText("Ship detail shell");

    expect(pressFind()).toBe(true);
    await act(async () => {});

    expect(container.querySelector('[role="search"]')).toBeNull();
  });

  it("gõ truy vấn cập nhật n / tổng; Enter tới kết quả sau, Shift+Enter về trước, vòng quanh ở hai đầu", async () => {
    comments = [
      { id: "c1", body: "mốc một", at: "00" },
      { id: "c2", body: "mốc hai", at: "01" },
      { id: "c3", body: "mốc ba", at: "02" },
    ];
    await renderPage();
    await screen.findByText("mốc ba");
    // jsdom has no CSS Custom Highlight API: everything below runs on the
    // fallback path that paints nothing but must still count and navigate.
    expect(typeof CSS === "undefined" || !("highlights" in CSS)).toBe(true);

    const input = await openFind();
    fireEvent.change(input, { target: { value: "MỐC" } });

    await waitFor(() => expect(findCount()).toHaveTextContent("1/3"));
    expect(findCount()).toHaveAttribute("aria-live", "polite");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(findCount()).toHaveTextContent("2/3");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(findCount()).toHaveTextContent("3/3");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(findCount()).toHaveTextContent("1/3");
    fireEvent.keyDown(input, { key: "Enter", shiftKey: true });
    expect(findCount()).toHaveTextContent("3/3");
    // A Vietnamese IME confirms a syllable with Enter (keyCode 229 while composing).
    fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
    expect(findCount()).toHaveTextContent("3/3");

    fireEvent.click(screen.getByRole("button", { name: /kết quả trước|previous match/i }));
    expect(findCount()).toHaveTextContent("2/3");
    fireEvent.click(screen.getByRole("button", { name: /kết quả tiếp theo|next match/i }));
    expect(findCount()).toHaveTextContent("3/3");
  });

  it("Escape đóng thanh tìm và trả focus về phần tử đang giữ focus trước khi mở", async () => {
    await renderPage();
    const toggle = screen.getByRole("button", {
      name: /hiện hoặc ẩn thuộc tính|show or hide properties/i,
    });
    toggle.focus();

    expect(pressFind(toggle)).toBe(false);
    const input = await screen.findByRole("textbox", { name: FIND_LABEL });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("search")).toBeNull();
    expect(toggle).toHaveFocus();
  });

  it("⌘F lần nữa khi đang ở ô tìm thì giữ thanh tìm, không nhường cho tìm của trình duyệt", async () => {
    await renderPage();
    const input = await openFind();

    expect(pressFind(input)).toBe(false);

    expect(input).toHaveFocus();
    expect(screen.getByRole("search")).toBeInTheDocument();
  });

  it("đổi sang task khác thì thanh tìm đóng", async () => {
    const view = await renderPage();
    await openFind();

    view.rerender(shell(<TaskDetailSuitePage workspaceId="w1" taskId="t2" />));
    await screen.findByText("Second task");

    expect(screen.queryByRole("search")).toBeNull();
  });

  describe("luồng đã giải quyết đang gấp", () => {
    it("truy vấn khớp chữ trong luồng đang gấp thì mở luồng đó và đếm kết quả; luồng không khớp vẫn gấp", async () => {
      comments = [
        { id: "c1", body: "Chốt ngân sách quý", at: "00", resolved: true },
        { id: "c2", body: "Ngân sách đã được duyệt", at: "01", parent_id: "c1" },
        { id: "c3", body: "Việc khác đã xong", at: "02", resolved: true },
        { id: "c4", body: "trả lời không liên quan", at: "03", parent_id: "c3" },
      ];
      await renderPage();
      await waitFor(() => expect(screen.getAllByTestId("resolved-thread-bar")).toHaveLength(2));
      expect(screen.queryByText("Ngân sách đã được duyệt")).toBeNull();

      const input = await openFind();
      fireEvent.change(input, { target: { value: "ngân sách" } });

      expect(await screen.findByText("Ngân sách đã được duyệt")).toBeInTheDocument();
      await waitFor(() => expect(findCount()).toHaveTextContent("1/2"));
      expect(screen.queryByText("trả lời không liên quan")).toBeNull();
    });

    it("đóng thanh tìm thì luồng chỉ mở vì tìm gấp lại, và bộ nhớ gấp mở không có mục mới cho task", async () => {
      comments = [
        { id: "c1", body: "Chốt ngân sách quý", at: "00", resolved: true },
        { id: "c2", body: "Ngân sách đã được duyệt", at: "01", parent_id: "c1" },
      ];
      await renderPage();
      await screen.findByTestId("resolved-thread-bar");

      const input = await openFind();
      fireEvent.change(input, { target: { value: "ngân sách" } });
      await screen.findByText("Ngân sách đã được duyệt");
      // Searching is not the person asking to keep the thread open.
      expect(useTaskDetailUiStore.getState().tasks).toEqual({});

      fireEvent.keyDown(input, { key: "Escape" });

      expect(screen.queryByText("Ngân sách đã được duyệt")).toBeNull();
      expect(screen.getByTestId("resolved-thread-bar")).toHaveAttribute("aria-expanded", "false");
      expect(useTaskDetailUiStore.getState().tasks).toEqual({});
    });

    it("luồng người dùng tự mở vẫn mở sau khi tìm rồi đóng thanh tìm", async () => {
      comments = [
        { id: "c1", body: "Chốt ngân sách quý", at: "00", resolved: true },
        { id: "c2", body: "Ngân sách đã được duyệt", at: "01", parent_id: "c1" },
      ];
      await renderPage();
      fireEvent.click(await screen.findByTestId("resolved-thread-bar"));
      expect(screen.getByText("Ngân sách đã được duyệt")).toBeInTheDocument();

      const input = await openFind();
      fireEvent.change(input, { target: { value: "ngân sách" } });
      await waitFor(() => expect(findCount()).toHaveTextContent("1/2"));
      fireEvent.keyDown(input, { key: "Escape" });

      expect(screen.getByText("Ngân sách đã được duyệt")).toBeInTheDocument();
      expect(screen.getByTestId("resolved-thread-bar")).toHaveAttribute("aria-expanded", "true");
      expect(useTaskDetailUiStore.getState().tasks.t1?.resolvedExpanded).toEqual(["c1"]);
    });

    // Text pasted from macOS files is often stored decomposed (NFD); keyboards
    // type composed (NFC). Both matchers must agree, or the thread opens with
    // "no matches" or the count finds text the thread matcher missed.
    it("bình luận lưu dạng NFD khớp truy vấn gõ dạng NFC: mở luồng và đếm được kết quả", async () => {
      const reply = "Biểu mẫu đã duyệt".normalize("NFD");
      comments = [
        { id: "c1", body: "Chốt biểu mẫu".normalize("NFD"), at: "00", resolved: true },
        { id: "c2", body: reply, at: "01", parent_id: "c1" },
      ];
      await renderPage();
      await screen.findByTestId("resolved-thread-bar");

      const input = await openFind();
      fireEvent.change(input, { target: { value: "biểu mẫu".normalize("NFC") } });

      expect(await screen.findByText(reply)).toBeInTheDocument();
      await waitFor(() => expect(findCount()).toHaveTextContent("1/2"));
    });
  });

  describe("đích của ⌘F", () => {
    it("trong một ô nhập bên ngoài trang chi tiết (như ô tìm của palette) thì không mở thanh tìm task", async () => {
      await renderPage(<input aria-label="palette search" />);
      const outside = screen.getByRole("textbox", { name: "palette search" });
      outside.focus();

      expect(pressFind(outside)).toBe(true);
      await act(async () => {});

      expect(screen.queryByRole("search")).toBeNull();
    });

    it("trong editor mô tả của chính task thì mở thanh tìm", async () => {
      await renderPage();
      const surface = await descriptionSurface();

      expect(pressFind(surface)).toBe(false);

      expect(await screen.findByRole("search")).toBeInTheDocument();
    });

    it("trong một lớp popup đang mở thì không mở thanh tìm", async () => {
      await renderPage(
        <div role="dialog" aria-label="popup">
          <button type="button">trong popup</button>
        </div>,
      );
      const inside = screen.getByRole("button", { name: "trong popup" });

      expect(pressFind(inside)).toBe(true);
      await act(async () => {});

      expect(screen.queryByRole("search")).toBeNull();
    });
  });

  describe("điều hướng luồng (openThreadNav)", () => {
    const chord = createShortcutChord("E", { primary: true, shift: true });
    const pressThreadNav = (target: Element = document.body) =>
      fireEvent.keyDown(target, { key: "E", metaKey: true, shiftKey: true });
    const fourThreads: CommentFixture[] = [
      { id: "c1", body: "luồng một", at: "00" },
      { id: "c2", body: "luồng hai", at: "01" },
      { id: "c3", body: "luồng ba", at: "02" },
      { id: "c4", body: "luồng bốn", at: "03" },
    ];

    beforeEach(() => {
      useShortcutStore.getState().setShortcut("openThreadNav", chord);
      expect(getShortcut("openThreadNav")).toEqual(chord);
    });

    it("gán phím rồi nhấn trên trang chi tiết thì focus vào mục đầu của bảng điều hướng luồng", async () => {
      comments = fourThreads;
      await renderPage();
      const nav = await screen.findByRole("navigation", { name: THREAD_NAV });

      expect(pressThreadNav()).toBe(false);

      expect(within(nav).getAllByRole("button")[0]).toHaveFocus();
    });

    it("bảng tự ẩn khi dưới bốn luồng thì phím không làm gì và không ném lỗi", async () => {
      comments = fourThreads.slice(0, 3);
      await renderPage();
      await screen.findByText("luồng ba");
      const before = document.activeElement;

      expect(pressThreadNav()).toBe(true);

      expect(document.activeElement).toBe(before);
    });

    it("không phản ứng khi đích là ô soạn thảo hay lớp popup", async () => {
      comments = fourThreads;
      await renderPage(
        <div role="menu">
          <button type="button">mục menu</button>
        </div>,
      );
      const nav = await screen.findByRole("navigation", { name: THREAD_NAV });
      const first = within(nav).getAllByRole("button")[0]!;

      expect(pressThreadNav(await descriptionSurface())).toBe(true);
      expect(first).not.toHaveFocus();

      const menuItem = screen.getByRole("button", { name: "mục menu" });
      menuItem.focus();
      expect(pressThreadNav(menuItem)).toBe(true);
      expect(menuItem).toHaveFocus();
    });
  });

  // chat-page-content.tsx listens for Ctrl/Cmd+F on window to search chat
  // messages. Task find lives on the detail page only, never in the shell's
  // dispatcher, so on the chat page the key reaches that listener unclaimed.
  it("trang chat giữ ⌘F: không có trang chi tiết thì bộ phím toàn cục không chiếm phím và không có thanh tìm task", async () => {
    const chatSearch = vi.fn<(alreadyClaimed: boolean) => void>();
    function ChatFindListener() {
      useEffect(() => {
        // Same condition as chat-page-content.tsx:165-172, plus a record of
        // whether anything earlier on the path already claimed the key.
        const onKeyDown = (event: KeyboardEvent) => {
          if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
            chatSearch(event.defaultPrevented);
            event.preventDefault();
          }
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
      }, []);
      return null;
    }
    render(
      shell(
        <>
          <GlobalShortcuts onCreateTask={vi.fn()} />
          <ChatFindListener />
        </>,
      ),
    );

    pressFind();

    expect(chatSearch).toHaveBeenCalledTimes(1);
    expect(chatSearch).toHaveBeenCalledWith(false);
    expect(screen.queryByRole("search")).toBeNull();
  });
});

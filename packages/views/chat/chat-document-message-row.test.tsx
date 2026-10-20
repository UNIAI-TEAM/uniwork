import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { chatKeys } from "@uniwork/core/chat";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { wrapWithNav, fakeNav } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import type { ChatDocumentDesktopOpen } from "./chat-document-menu";
import { ChatDocumentMessageRow } from "./chat-document-message-row";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";

const useDocumentMock = vi.fn();
const useDocumentLimitsMock = vi.fn();
const useUploadDocumentFileMock = vi.fn();
const useCommitDocumentVersionMock = vi.fn();

vi.mock("@uniwork/core/documents/hooks", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/documents/hooks")>()),
  useDocument: (...a: unknown[]) => useDocumentMock(...a),
  useDocumentLimits: (...a: unknown[]) => useDocumentLimitsMock(...a),
  useUploadDocumentFile: (...a: unknown[]) => useUploadDocumentFileMock(...a),
}));
vi.mock("@uniwork/core/documents/hooks-versions", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/documents/hooks-versions")>()),
  useCommitDocumentVersion: (...a: unknown[]) => useCommitDocumentVersionMock(...a),
}));

initI18n();

const user: User = {
  id: "u1",
  email: "a@b.c",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: "ws1",
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function documentMessage(
  document: ChatMessage["document"],
  message: Partial<ChatMessage> = {},
): ChatMessage {
  return {
    id: "m-doc",
    sender: "u2",
    body: "Báo cáo Q3.docx",
    kind: "document",
    ts: Date.now(),
    reactions: {},
    ...message,
    ...(document ? { document } : {}),
  };
}

type RowProps = Parameters<typeof ChatDocumentMessageRow>[0];

function row(message: ChatMessage, props: Partial<RowProps> = {}) {
  return (
    <WorkspaceProvider workspace={workspace} user={user}>
      <ChatDocumentMessageRow
        workspaceId="ws1"
        roomId="room1"
        message={message}
        senderLabel="Bình"
        isOwn={false}
        showSenderName={false}
        compactTop={false}
        showAvatar={false}
        {...props}
      />
    </WorkspaceProvider>
  );
}

function renderCard(
  message: ChatMessage,
  props: Partial<RowProps> = {},
  nav = fakeNav(),
  client?: QueryClient,
) {
  render(wrapWithNav(row(message, props), nav, client));
  return nav;
}

/** A live row: the message menu (and the document entries in it) needs reply and react. */
const LIVE = { onReply: vi.fn(), onReact: vi.fn() } satisfies Partial<RowProps>;

async function openMenu() {
  await userEvent.click(screen.getByRole("button", { name: "Thêm" }));
  return screen.findByRole("menu");
}

function menuLabels(menu: HTMLElement): string[] {
  return within(menu)
    .getAllByRole("menuitem")
    .map((item) => item.textContent?.trim() ?? "");
}

const DOC = {
  document_id: "doc1",
  viewer_has_access: true,
  title: "Báo cáo Q3",
  format: "docx",
  version_number: 3,
  revision: "42",
};

const FULL = {
  ...DOC,
  viewer_level: "manage" as const,
  recipient_count: 2,
  viewer_can_manage: true,
  viewer_can_upload_version: true,
  can_open_in_app: true,
};

function desktopFactory(createSession = vi.fn(async () => null)) {
  return vi.fn(() => ({
    deploymentId: "dep-1",
    channel: "stable",
    savedVersion: 3,
    createSession,
    loadInstallers: vi.fn(),
    loadPlatformHint: vi.fn(),
    downloadInstaller: vi.fn(),
    launch: vi.fn(),
  })) as unknown as ChatDocumentDesktopOpen & ReturnType<typeof vi.fn>;
}

const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

/** Opens "Tải lên phiên bản mới" from the menu, picks a file and submits it. */
async function uploadFromMenu(name = "v4.docx") {
  await userEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Tải lên phiên bản mới" }));
  const input = await waitFor(() => {
    const found = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(found).toBeTruthy();
    return found!;
  });
  fireEvent.change(input, { target: { files: [new File(["x"], name, { type: DOCX })] } });
  fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));
}

describe("ChatDocumentMessageRow", () => {
  beforeEach(() => {
    vi.mocked(toast.error).mockClear();
    useDocumentMock.mockReset().mockReturnValue({ data: undefined, isError: false });
    useDocumentLimitsMock.mockReset().mockReturnValue({ upload_max_bytes: 200 * 1024 * 1024 });
    useUploadDocumentFileMock.mockReset().mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    useCommitDocumentVersionMock.mockReset().mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
  });

  it("washes the row on a deep-link jump like the other rows, without the heavy ring (UNI-2010)", () => {
    renderCard(documentMessage(DOC), { highlighted: true });
    const article = document.querySelector("#chat-msg-m-doc");
    expect(article).toHaveClass("before:bg-brand-subtle", "before:ring-1", "before:ring-brand/25");
    expect(article).not.toHaveClass("ring-2");
    expect(article).not.toHaveClass("ring-brand");
    expect(article).not.toHaveClass("bg-brand-subtle");
  });

  describe("on the bubble it sits on (UNI-2010)", () => {
    // A bare outline/ghost/default class set resolves to bg-background / bg-primary on the brand bubble.
    const barePaint = ["bg-background", "dark:bg-input/30", "border-input", "bg-primary", "bg-secondary", "text-muted-foreground", "text-foreground"];
    const ownControl = ["bg-chat-bubble-own-foreground/15", "text-chat-bubble-own-foreground"];

    it("keeps no action buttons on the card: the title is its only control (UNI-2012 S7)", () => {
      for (const isOwn of [true, false]) {
        const view = render(wrapWithNav(row(documentMessage(FULL), { isOwn, desktopOpen: desktopFactory() })));
        const article = view.container.querySelector("article")!;
        const inCard = within(article)
          .getAllByRole("button")
          .filter((button) => !button.closest("[data-message-actions]"));
        expect(inCard.map((button) => button.getAttribute("aria-label"))).toEqual(["Mở trong Tài liệu: Báo cáo Q3"]);
        view.unmount();
      }
    });

    it("own bubble: title, secondary line and level badge stay readable on the brand fill", () => {
      renderCard(documentMessage(FULL), { isOwn: true });
      expect(screen.getByRole("button", { name: /Mở trong Tài liệu/ })).toHaveClass("text-chat-bubble-own-foreground");
      expect(screen.getByRole("button", { name: /Mở trong Tài liệu/ })).not.toHaveClass("text-foreground");
      expect(screen.getByRole("button", { name: /Mở trong Tài liệu/ })).toHaveClass("focus-visible:outline-chat-bubble-own-foreground");
      const secondary = screen.getByText(/Phiên bản 3/);
      expect(secondary).toHaveClass("text-chat-bubble-own-meta");
      expect(secondary).not.toHaveClass("text-muted-foreground");
      const badge = screen.getByText("Quản lý");
      expect(badge).toHaveClass(...ownControl);
      expect(badge).not.toHaveClass("bg-secondary");
      // The badge is a plain span: only the resting look, never the control's hover / open / focus states.
      expect(badge.className).not.toMatch(/(^|\s)(hover|aria-expanded|focus-visible):\S*chat-bubble-own/);
    });

    it("other bubble: the time stays plain meta in its px-1 wrapper, no wall chip", () => {
      renderCard(documentMessage(FULL), { isOwn: false });
      const meta = document.querySelector("time")?.parentElement;
      expect(meta).not.toHaveClass("bg-chat-chip");
      expect(meta).not.toHaveClass("text-chat-chip-foreground");
      expect(meta).not.toHaveClass("self-end");
      expect(meta?.parentElement).toHaveClass("px-1");
    });

    it("own bubble: the time and ticks sit on the wall chip, not in the near-white own-meta tone", () => {
      renderCard(documentMessage(FULL), { isOwn: true });
      const time = document.querySelector("time");
      const meta = time?.parentElement;
      expect(meta).toHaveClass("bg-chat-chip", "text-chat-chip-foreground", "self-end");
      expect(meta).not.toHaveClass("text-chat-bubble-own-meta");
      expect(meta?.querySelector(".text-chat-bubble-own-foreground")).toBeNull();
      // self-end only aligns the chip under my bubble inside the column's flex container, as the GIF row does.
      expect(meta?.parentElement).toHaveClass("flex", "flex-col");
    });

    it("own bubble: the locked card and the neutral card read on the brand fill", () => {
      renderCard(documentMessage({ document_id: "doc1", viewer_has_access: false }), { isOwn: true });
      const request = screen.getByRole("button", { name: "Yêu cầu quyền truy cập" });
      expect(request).toHaveClass(...ownControl);
      for (const bare of barePaint) expect(request).not.toHaveClass(bare);
      expect(screen.getByText("Không có quyền truy cập")).toHaveClass("text-chat-bubble-own-foreground");
    });

    it("own bubble: the neutral filename card keeps its text readable", () => {
      renderCard(documentMessage(undefined), { isOwn: true });
      expect(screen.getByText("Báo cáo Q3.docx")).toHaveClass("text-chat-bubble-own-foreground");
    });

    it("other bubble: grey secondary text and the plain title and badge", () => {
      renderCard(documentMessage(FULL), { isOwn: false });
      expect(screen.getByText(/Phiên bản 3/)).toHaveClass("text-muted-foreground");
      expect(screen.getByRole("button", { name: /Mở trong Tài liệu/ })).toHaveClass("text-foreground");
      expect(screen.getByText("Quản lý")).toHaveClass("bg-secondary");
    });
  });

  it("renders a neutral filename card when the document block is absent", () => {
    renderCard(documentMessage(undefined));
    expect(screen.getByText("Báo cáo Q3.docx")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mở trong Tài liệu/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Phiên bản/)).not.toBeInTheDocument();
  });

  it("renders the locked card for a viewer without access", () => {
    renderCard(documentMessage({ document_id: "doc1", viewer_has_access: false }));
    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    // The block carries nothing else: no title and no document actions, only
    // the request-access button (S-DOC07 is on the base).
    expect(screen.queryByText("Báo cáo Q3")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button").map((b) => b.textContent)).toEqual(["Yêu cầu quyền truy cập"]);
  });

  it("renders the full card and opens the document from the title", () => {
    const nav = renderCard(documentMessage(DOC));
    expect(screen.getByRole("button", { name: "Mở trong Tài liệu: Báo cáo Q3" })).toBeInTheDocument();
    expect(screen.getByText("Phiên bản 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở trong Tài liệu: Báo cáo Q3" }));
    expect(nav.push).toHaveBeenCalledWith("/acme/team/documents/doc1");
  });

  it("gives the card room: the title shows in full on hover and the secondary line is not truncated (F-03)", () => {
    renderCard(documentMessage({ ...DOC, title: "bao-cao-q3-du-lieu-chi-tiet.docx", recipient_count: 1 }));
    const titleButton = screen.getByRole("button", { name: /Mở trong Tài liệu/ });
    // The hover text is the document title; the accessible name keeps the action.
    expect(titleButton).toHaveAttribute("title", "bao-cao-q3-du-lieu-chi-tiet.docx");
    expect(titleButton).toHaveAttribute("aria-label", "Mở trong Tài liệu: bao-cao-q3-du-lieu-chi-tiet.docx");
    expect(titleButton.className).toContain("truncate");
    const secondary = screen.getByText(/Phiên bản 3/);
    expect(secondary.textContent).toBe("Phiên bản 3 · Đã chia sẻ với 1 người");
    expect(secondary.className).not.toContain("truncate");
    // A fixed width capped by the bubble, not the content's min width.
    const card = titleButton.closest("div.flex-col");
    expect(card?.className).toContain("w-[22rem]");
    expect(card?.className).toContain("max-w-full");
    // The row that holds the avatar, bubble and actions rail is wide enough for
    // that card (36rem, the text row's cap) — the 26rem file-row cap clamped it.
    const row = card?.closest("div[class*=\"max-w-[min(85%\"]");
    expect(row?.className).toContain("max-w-[min(85%,36rem)]");
    expect(row?.className).not.toContain("26rem");
  });

  it("lets the locked heading wrap and puts the action below it (F-02)", () => {
    renderCard(documentMessage({ document_id: "doc1", viewer_has_access: false }));
    const heading = screen.getByText("Không có quyền truy cập");
    expect(heading.className).not.toContain("truncate");
    const button = screen.getByRole("button", { name: "Yêu cầu quyền truy cập" });
    const card = heading.closest("div.flex-col");
    expect(card?.contains(button)).toBe(true);
    // The button is not in the heading's row: it sits in its own slot below.
    expect(heading.parentElement?.contains(button)).toBe(false);
  });

  it("shows the sender's share count and the viewer's level badge", () => {
    renderCard(documentMessage({ ...DOC, viewer_level: "comment", recipient_count: 4 }));
    expect(screen.getByText(/Đã chia sẻ với 4 người/)).toBeInTheDocument();
    expect(screen.getByText("Nhận xét")).toBeInTheDocument();
  });

  it("renders no badge when the viewer level is absent (old server)", () => {
    renderCard(documentMessage({ ...DOC, viewer_level: undefined }));
    expect(screen.queryByText("Nhận xét")).not.toBeInTheDocument();
    expect(screen.queryByText("Chỉ xem")).not.toBeInTheDocument();
  });

  describe("the role menu (UNI-2012 S7, contract D3)", () => {
    const MESSAGE_ITEMS = ["Trả lời", "Sao chép"];

    it("leads the manager's menu with every document entry, in order", async () => {
      renderCard(documentMessage(FULL), { ...LIVE, desktopOpen: desktopFactory() });
      const labels = menuLabels(await openMenu());
      expect(labels.slice(0, 5)).toEqual([
        "Chỉnh sửa trong UniWork Office",
        "Chỉnh sửa trên web",
        "Tải lên phiên bản mới",
        "Lịch sử phiên bản",
        "Chia sẻ",
      ]);
      expect(labels).toEqual(expect.arrayContaining(MESSAGE_ITEMS));
    });

    it("gives an editor the edit entries but not Share", async () => {
      renderCard(
        documentMessage({ ...DOC, viewer_level: "edit", viewer_can_upload_version: true, can_open_in_app: true }),
        { ...LIVE, desktopOpen: desktopFactory() },
      );
      const labels = menuLabels(await openMenu());
      expect(labels.slice(0, 4)).toEqual([
        "Chỉnh sửa trong UniWork Office",
        "Chỉnh sửa trên web",
        "Tải lên phiên bản mới",
        "Lịch sử phiên bản",
      ]);
      expect(labels).not.toContain("Chia sẻ");
    });

    it.each(["view", "comment"] as const)("gives a %s reader the open and history entries only", async (level) => {
      const desktopOpen = desktopFactory();
      renderCard(documentMessage({ ...DOC, viewer_level: level, can_open_in_app: true }), { ...LIVE, desktopOpen });
      const labels = menuLabels(await openMenu());
      expect(labels.slice(0, 2)).toEqual(["Mở để xem và nhận xét", "Lịch sử phiên bản"]);
      for (const absent of ["Chỉnh sửa trong UniWork Office", "Chỉnh sửa trên web", "Tải lên phiên bản mới", "Chia sẻ"]) {
        expect(labels).not.toContain(absent);
      }
      expect(desktopOpen).not.toHaveBeenCalled();
    });

    it("labels the web entry for reading when the frame cannot open the document (can_open_in_app false)", async () => {
      renderCard(documentMessage({ ...FULL, viewer_level: "edit", can_open_in_app: false }), LIVE);
      const labels = menuLabels(await openMenu());
      expect(labels).toContain("Mở để xem và nhận xét");
      expect(labels).not.toContain("Chỉnh sửa trên web");
    });

    it("keeps the edit label when can_open_in_app is absent (old server)", async () => {
      renderCard(documentMessage({ ...FULL, viewer_level: "edit", can_open_in_app: undefined }), LIVE);
      const labels = menuLabels(await openMenu());
      expect(labels).toContain("Chỉnh sửa trên web");
      expect(labels).not.toContain("Mở để xem và nhận xét");
    });

    it("hides the upload entry without the grant or without a revision", async () => {
      renderCard(documentMessage({ ...DOC, viewer_level: "edit", viewer_can_upload_version: true, revision: undefined }), LIVE);
      expect(menuLabels(await openMenu())).not.toContain("Tải lên phiên bản mới");
    });

    it("offers no document entry to a reader without access, nor on a card without a block", async () => {
      for (const document of [{ document_id: "doc1", viewer_has_access: false }, undefined]) {
        const view = render(wrapWithNav(row(documentMessage(document), { ...LIVE, desktopOpen: desktopFactory() })));
        const labels = menuLabels(await openMenu());
        expect(labels.filter((label) => /tài liệu|phiên bản|Chia sẻ|UniWork Office|trên web/.test(label))).toEqual([]);
        // The message's own menu still leads: nothing of the document precedes Reply.
        expect(labels[0]).toBe("Trả lời");
        view.unmount();
      }
    });

    it("in the UniChat shell (no host wiring, D7): no Office entry, and the page entries still go through navigation", async () => {
      // The shell's navigation policy hands every non-chat path to the
      // browser (apps/web chat-only-navigation), so the card only pushes.
      const nav = renderCard(documentMessage(FULL), LIVE);
      const labels = menuLabels(await openMenu());
      expect(labels.slice(0, 4)).toEqual(["Chỉnh sửa trên web", "Tải lên phiên bản mới", "Lịch sử phiên bản", "Chia sẻ"]);
      await userEvent.click(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Lịch sử phiên bản" }));
      expect(nav.push).toHaveBeenLastCalledWith("/acme/team/documents/doc1?panel=versions");
    });

    it("hides the Office entry when can_open_in_app is absent or false (RFC-03), or with no host wiring", async () => {
      for (const props of [
        { message: documentMessage({ ...FULL, can_open_in_app: undefined }), desktopOpen: desktopFactory() },
        { message: documentMessage({ ...FULL, can_open_in_app: false }), desktopOpen: desktopFactory() },
        { message: documentMessage(FULL), desktopOpen: undefined },
      ]) {
        const view = render(wrapWithNav(row(props.message, { ...LIVE, desktopOpen: props.desktopOpen })));
        expect(menuLabels(await openMenu())).not.toContain("Chỉnh sửa trong UniWork Office");
        if (props.desktopOpen) expect(props.desktopOpen).not.toHaveBeenCalled();
        view.unmount();
      }
    });

    it("carries the same entries in the right-click menu", async () => {
      renderCard(documentMessage(FULL), LIVE);
      fireEvent.contextMenu(screen.getByText("Báo cáo Q3"));
      const menu = await screen.findByRole("menu");
      expect(menuLabels(menu).slice(0, 4)).toEqual([
        "Chỉnh sửa trên web",
        "Tải lên phiên bản mới",
        "Lịch sử phiên bản",
        "Chia sẻ",
      ]);
    });

    it("opens the document page for editing, to read, and on its version history", async () => {
      const nav = renderCard(documentMessage(FULL), LIVE);
      await userEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Chỉnh sửa trên web" }));
      expect(nav.push).toHaveBeenLastCalledWith("/acme/team/documents/doc1");
      await userEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Lịch sử phiên bản" }));
      expect(nav.push).toHaveBeenLastCalledWith("/acme/team/documents/doc1?panel=versions");
    });

    it("opens the page from the reader's entry", async () => {
      const nav = renderCard(documentMessage({ ...DOC, viewer_level: "comment" }), LIVE);
      await userEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Mở để xem và nhận xét" }));
      expect(nav.push).toHaveBeenLastCalledWith("/acme/team/documents/doc1");
    });

    it("hands the document to the desktop app for editing through the host factory", async () => {
      const createSession = vi.fn(async () => null);
      const desktopOpen = desktopFactory(createSession);
      renderCard(documentMessage(FULL), { ...LIVE, desktopOpen });
      expect(desktopOpen).toHaveBeenCalledWith({ id: "doc1", organization_id: "o1", current_version: 3 });
      await userEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Chỉnh sửa trong UniWork Office" }));
      await waitFor(() => expect(createSession).toHaveBeenCalledWith("doc1", expect.objectContaining({ operation: "edit" })));
      // No ticket: the failure is a toast, nothing lands in the bubble.
      await waitFor(() => expect(toast.error).toHaveBeenCalledOnce());
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("Chia sẻ", () => {
    it("lazy-loads the detail only once asked, then opens the share dialog", async () => {
      useDocumentMock.mockReturnValue({ data: { id: "doc1", title: "Báo cáo Q3" }, isError: false });
      renderCard(documentMessage(FULL), LIVE);
      expect(useDocumentMock).not.toHaveBeenCalled();
      await userEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Chia sẻ" }));
      expect(useDocumentMock).toHaveBeenCalledWith("ws1", "doc1", { enabled: true });
      // The dialog mounts outside the menu, so the menu closing leaves it open.
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      await waitFor(() => expect(screen.queryByRole("menu")).not.toBeInTheDocument());
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("toasts again on a second failure and opens the dialog on a later success (RFC-08)", async () => {
      const nav = fakeNav();
      const message = documentMessage(FULL);
      const view = render(wrapWithNav(row(message, LIVE), nav));
      const rerender = () => view.rerender(wrapWithNav(row(message, LIVE), nav));
      const share = async () => userEvent.click(within(await openMenu()).getByRole("menuitem", { name: "Chia sẻ" }));

      // First failure: one toast, and the query is switched back off so the
      // card does not hammer the detail read.
      useDocumentMock.mockReturnValue({ data: undefined, isError: true, error: new ApiError("down", "internal", 500) });
      await share();
      rerender();
      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
      expect(useDocumentMock).toHaveBeenLastCalledWith("ws1", "doc1", { enabled: false });

      // Second failure toasts again — the flag resets on each ask.
      useDocumentMock.mockReturnValue({ data: undefined, isError: true, error: new ApiError("down again", "internal", 500) });
      await share();
      rerender();
      await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));

      // A later success still opens the share dialog.
      useDocumentMock.mockReturnValue({ data: { id: "doc1", title: "Báo cáo Q3" }, isError: false });
      await share();
      rerender();
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
    });
  });

  describe("Tải lên phiên bản mới (UNI-2012 S6)", () => {
    function mockUpload(commitImpl: () => Promise<unknown> = async () => ({ version: { id: "v4" } })) {
      const upload = { mutateAsync: vi.fn(async () => ({ upload_id: "up-1" })), isPending: false };
      const commit = { mutateAsync: vi.fn(commitImpl), isPending: false };
      useUploadDocumentFileMock.mockReturnValue(upload);
      useCommitDocumentVersionMock.mockReturnValue(commit);
      return { upload, commit };
    }

    it("commits a staged version with the room named (contract §4.4)", async () => {
      const { upload, commit } = mockUpload();
      renderCard(documentMessage(FULL), LIVE);
      await uploadFromMenu();

      await waitFor(() => expect(commit.mutateAsync).toHaveBeenCalled());
      expect(upload.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ file: expect.any(File), idempotencyKey: expect.any(String) }),
      );
      expect(commit.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          upload_id: "up-1",
          base_revision: "42",
          chat_room_id: "room1",
          idempotencyKey: expect.any(String),
        }),
      );
    });

    it("refreshes the room timeline after a committed version so the card carries the new revision", async () => {
      // The version line arrives as its own message (chat.message.created); the
      // card is a different message whose `revision` is the base of the NEXT
      // commit, so it must be re-read or a second upload answers 409.
      const { commit } = mockUpload();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const invalidate = vi.spyOn(client, "invalidateQueries");
      renderCard(documentMessage(FULL), LIVE, fakeNav(), client);
      await uploadFromMenu();

      await waitFor(() => expect(commit.mutateAsync).toHaveBeenCalled());
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: chatKeys.roomMessages("ws1", "room1") })),
      );
    });

    it("shows the chat 409 copy and refreshes the room timeline after a version conflict (RFC-04)", async () => {
      mockUpload(async () => {
        throw new ApiError("conflict", "document_version_conflict", 409);
      });
      const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
      const invalidate = vi.spyOn(client, "invalidateQueries");
      renderCard(documentMessage(FULL), LIVE, fakeNav(), client);
      await uploadFromMenu();

      // The card's own sentence, not the history-page restore copy.
      expect(await screen.findByText("Tài liệu vừa có phiên bản mới. Tải lại rồi thử lại.")).toBeInTheDocument();
      await waitFor(() =>
        expect(invalidate).toHaveBeenCalledWith(expect.objectContaining({ queryKey: chatKeys.roomMessages("ws1", "room1") })),
      );
    });

    it("names the holder when someone else holds the edit lock (423)", async () => {
      mockUpload(async () => {
        throw new ApiError("locked", "document_locked", 423, undefined, { holder_name: "Chi", held_by_me: false });
      });
      renderCard(documentMessage(FULL), LIVE);
      await uploadFromMenu();
      expect(await screen.findByRole("alert")).toHaveTextContent("Chi đang sửa tài liệu này. Thử lại khi họ lưu xong.");
      expect(screen.queryByRole("button", { name: "Mở trang tài liệu" })).not.toBeInTheDocument();
    });

    it("gives the reader's own hold in another window its sentence and the way to the document page (contract D6)", async () => {
      mockUpload(async () => {
        throw new ApiError("locked", "document_locked", 423, undefined, { held_by_me: true });
      });
      const nav = renderCard(documentMessage(FULL), LIVE);
      await uploadFromMenu();
      // The document page's sentence: a page tab opened from here holds nothing either.
      expect(await screen.findByRole("alert")).toHaveTextContent(
        "Bạn đang sửa tài liệu này ở một cửa sổ khác. Lưu hoặc đóng cửa sổ đó rồi thử lại.",
      );
      fireEvent.click(screen.getByRole("button", { name: "Mở trang tài liệu" }));
      expect(nav.push).toHaveBeenLastCalledWith("/acme/team/documents/doc1");
    });

    it("resets the version Idempotency-Key when a different file is picked (RFC-08)", async () => {
      const upload = {
        mutateAsync: vi
          .fn<(args: { file: File; idempotencyKey: string }) => Promise<{ upload_id: string }>>()
          .mockRejectedValue(new ApiError("down", "internal", 500)),
        isPending: false,
      };
      useUploadDocumentFileMock.mockReturnValue(upload);
      renderCard(documentMessage(FULL), LIVE);

      await uploadFromMenu("v4-a.docx");
      await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(1));
      const firstKey = upload.mutateAsync.mock.calls[0]![0].idempotencyKey;

      // A different file is a new intent: the key must not survive the pick,
      // or the server could replay the first upload for different bytes.
      fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
        target: { files: [new File(["x"], "v4-b.docx", { type: DOCX })] },
      });
      fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));
      await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(2));
      expect(upload.mutateAsync.mock.calls[1]![0].idempotencyKey).not.toBe(firstKey);
    });

    it("keeps the version Idempotency-Key while retrying the same file (RFC-08)", async () => {
      const upload = {
        mutateAsync: vi
          .fn<(args: { file: File; idempotencyKey: string }) => Promise<{ upload_id: string }>>()
          .mockRejectedValue(new ApiError("down", "internal", 500)),
        isPending: false,
      };
      useUploadDocumentFileMock.mockReturnValue(upload);
      renderCard(documentMessage(FULL), LIVE);

      await uploadFromMenu();
      await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(1));
      // Same file, retried: the staged upload replays under the same key.
      fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));
      await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(2));
      expect(upload.mutateAsync.mock.calls[1]![0].idempotencyKey).toBe(upload.mutateAsync.mock.calls[0]![0].idempotencyKey);
    });
  });
});

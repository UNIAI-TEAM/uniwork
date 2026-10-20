import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { chatKeys } from "@uniwork/core/chat";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { wrapWithNav, fakeNav } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatDocumentMessageRow, type ChatDocumentDesktopOpen } from "./chat-document-message-row";

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

function renderCard(
  message: ChatMessage,
  props: Partial<Parameters<typeof ChatDocumentMessageRow>[0]> = {},
  nav = fakeNav(),
  client?: QueryClient,
) {
  render(
    wrapWithNav(
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
      </WorkspaceProvider>,
      nav,
      client,
    ),
  );
  return nav;
}

const DOC = {
  document_id: "doc1",
  viewer_has_access: true,
  title: "Báo cáo Q3",
  format: "docx",
  version_number: 3,
  revision: "42",
};

describe("ChatDocumentMessageRow", () => {
  beforeEach(() => {
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
    const FULL = {
      ...DOC,
      viewer_level: "manage" as const,
      recipient_count: 2,
      viewer_can_manage: true,
      viewer_can_upload_version: true,
      can_open_in_app: true,
    };
    const desktopOpen = (() => ({
      deploymentId: "dep-1",
      channel: "stable",
      savedVersion: 3,
      loadInstallers: vi.fn(),
      loadPlatformHint: vi.fn(),
      downloadInstaller: vi.fn(),
      launch: vi.fn(),
    })) as unknown as ChatDocumentDesktopOpen;
    // A bare outline/ghost/default class set resolves to bg-background / bg-primary on the brand bubble.
    const barePaint = ["bg-background", "dark:bg-input/30", "border-input", "bg-primary", "bg-secondary", "text-muted-foreground", "text-foreground"];
    const ownControl = ["bg-chat-bubble-own-foreground/15", "text-chat-bubble-own-foreground"];
    // Hover / open menu invert to white with brand text (>= 4.5:1); the old /25 wash measured 3.86:1.
    const ownInverted = [
      "hover:bg-chat-bubble-own-foreground",
      "hover:text-chat-bubble-own",
      "aria-expanded:bg-chat-bubble-own-foreground",
      "aria-expanded:text-chat-bubble-own",
      "focus-visible:outline-chat-bubble-own-foreground",
    ];

    it("own bubble: every control wears the own-bubble family, none a bare variant paint", () => {
      renderCard(documentMessage(FULL), { isOwn: true, desktopOpen });
      for (const name of ["Quản lý quyền truy cập", "Tải lên phiên bản mới", "Tùy chọn UniWork Office"]) {
        const control = screen.getByRole("button", { name });
        expect(control).toHaveClass(...ownControl, ...ownInverted);
        expect(control).not.toHaveClass("hover:bg-chat-bubble-own-foreground/25", "aria-expanded:bg-chat-bubble-own-foreground/25");
        for (const bare of barePaint) expect(control).not.toHaveClass(bare);
      }
      // The primary Open button inverts: it must not vanish into the brand fill.
      const open = screen.getByRole("button", { name: "Mở bằng UniWork Office" });
      expect(open).toHaveClass("bg-chat-bubble-own-foreground", "text-chat-bubble-own", "focus-visible:outline-chat-bubble-own-foreground");
      expect(open).not.toHaveClass("bg-primary");
      expect(open).not.toHaveClass("text-primary-foreground");
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

    it("other bubble: the card keeps its outline buttons, grey secondary text and brand primary", () => {
      renderCard(documentMessage(FULL), { isOwn: false, desktopOpen });
      for (const name of ["Quản lý quyền truy cập", "Tải lên phiên bản mới", "Tùy chọn UniWork Office"]) {
        const control = screen.getByRole("button", { name });
        expect(control).toHaveClass("bg-background", "border-input");
        expect(control).not.toHaveClass("bg-chat-bubble-own-foreground/15");
      }
      expect(screen.getByRole("button", { name: "Mở bằng UniWork Office" })).toHaveClass("bg-primary", "text-primary-foreground");
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

  it("shows manage access only when the block grants it, and lazy-loads the detail", () => {
    const doc = { id: "doc1", title: "Báo cáo Q3" };
    useDocumentMock.mockReturnValue({ data: doc, isError: false });
    renderCard(documentMessage({ ...DOC, viewer_can_manage: true }));
    expect(useDocumentMock).toHaveBeenCalledWith("ws1", "doc1", { enabled: false });
    fireEvent.click(screen.getByRole("button", { name: "Quản lý quyền truy cập" }));
    expect(useDocumentMock).toHaveBeenCalledWith("ws1", "doc1", { enabled: true });
    // The share dialog mounts once the detail is in.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("hides manage access for a plain viewer", () => {
    renderCard(documentMessage({ ...DOC, viewer_can_manage: false }));
    expect(screen.queryByRole("button", { name: "Quản lý quyền truy cập" })).not.toBeInTheDocument();
  });

  it("commits a staged version with the room named (contract §4.4)", async () => {
    const upload = { mutateAsync: vi.fn(async () => ({ upload_id: "up-1" })), isPending: false };
    const commit = { mutateAsync: vi.fn(async () => ({})), isPending: false };
    useUploadDocumentFileMock.mockReturnValue(upload);
    useCommitDocumentVersionMock.mockReturnValue(commit);
    renderCard(documentMessage({ ...DOC, viewer_can_upload_version: true }));

    fireEvent.click(screen.getByRole("button", { name: "Tải lên phiên bản mới" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).toBeTruthy();
    fireEvent.change(input!, { target: { files: [new File(["x"], "v4.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })] } });
    fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));

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
    const upload = { mutateAsync: vi.fn(async () => ({ upload_id: "up-1" })), isPending: false };
    const commit = { mutateAsync: vi.fn(async () => ({})), isPending: false };
    useUploadDocumentFileMock.mockReturnValue(upload);
    useCommitDocumentVersionMock.mockReturnValue(commit);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderCard(documentMessage({ ...DOC, viewer_can_upload_version: true }), {}, fakeNav(), client);

    fireEvent.click(screen.getByRole("button", { name: "Tải lên phiên bản mới" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [
          new File(["x"], "v4.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));

    await waitFor(() => expect(commit.mutateAsync).toHaveBeenCalled());
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: chatKeys.roomMessages("ws1", "room1") }),
      ),
    );
  });

  it("hides the version upload without the grant or without a revision", () => {
    renderCard(documentMessage({ ...DOC, viewer_can_upload_version: true, revision: undefined }));
    expect(screen.queryByRole("button", { name: "Tải lên phiên bản mới" })).not.toBeInTheDocument();
  });

  it("wires the desktop open action through the host factory", () => {
    const desktopOpen = vi.fn<ChatDocumentDesktopOpen>(() => ({
      deploymentId: "dep-1",
      channel: "stable",
      savedVersion: 3,
      loadInstallers: vi.fn(),
      loadPlatformHint: vi.fn(),
      downloadInstaller: vi.fn(),
      launch: vi.fn(),
    })) as unknown as ChatDocumentDesktopOpen;
    renderCard(
      documentMessage({ ...DOC, can_open_in_app: true }),
      { desktopOpen },
    );
    expect(desktopOpen).toHaveBeenCalledWith({
      id: "doc1",
      organization_id: "o1",
      current_version: 3,
    });
    expect(screen.getByRole("button", { name: /Mở bằng UniWork Office/ })).toBeInTheDocument();
  });

  it("hides the desktop action when the card says the app cannot open it", () => {
    const desktopOpen = vi.fn() as unknown as ChatDocumentDesktopOpen;
    renderCard(documentMessage({ ...DOC, can_open_in_app: false }), { desktopOpen });
    expect(desktopOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Mở bằng UniWork Office/ })).not.toBeInTheDocument();
  });

  it("hides the desktop action when can_open_in_app is absent (RFC-03)", () => {
    // The server alone decides openability (module + version + not archived);
    // an absent field is drift, not consent — the card mints no session.
    const desktopOpen = vi.fn() as unknown as ChatDocumentDesktopOpen;
    renderCard(documentMessage(DOC), { desktopOpen });
    expect(desktopOpen).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Mở bằng UniWork Office/ })).not.toBeInTheDocument();
  });

  it("hides the desktop action without viewer access even when the app could open it", () => {
    const desktopOpen = vi.fn() as unknown as ChatDocumentDesktopOpen;
    renderCard(documentMessage({ document_id: "doc1", viewer_has_access: false, can_open_in_app: true }), {
      desktopOpen,
    });
    expect(desktopOpen).not.toHaveBeenCalled();
  });

  it("shows the chat 409 copy and refreshes the room timeline after a version conflict (RFC-04)", async () => {
    const conflict = new ApiError("conflict", "document_version_conflict", 409);
    const upload = { mutateAsync: vi.fn(async () => ({ upload_id: "up-1" })), isPending: false };
    const commit = { mutateAsync: vi.fn(async () => { throw conflict; }), isPending: false };
    useUploadDocumentFileMock.mockReturnValue(upload);
    useCommitDocumentVersionMock.mockReturnValue(commit);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    renderCard(documentMessage({ ...DOC, viewer_can_upload_version: true }), {}, fakeNav(), client);

    fireEvent.click(screen.getByRole("button", { name: "Tải lên phiên bản mới" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]');
    fireEvent.change(input!, {
      target: {
        files: [
          new File(["x"], "v4.docx", {
            type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          }),
        ],
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));

    // The card's own sentence, not the history-page restore copy.
    expect(
      await screen.findByText("Tài liệu vừa có phiên bản mới. Tải lại rồi thử lại."),
    ).toBeInTheDocument();
    // The stale revision is the cause: the room timeline refetches so the
    // card re-reads the current one (and the document_version line lands).
    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: chatKeys.roomMessages("ws1", "room1") }),
      ),
    );
  });

  it("resets the version Idempotency-Key when a different file is picked (RFC-08)", async () => {
    const upload = {
      mutateAsync: vi
        .fn<(args: { file: File; idempotencyKey: string }) => Promise<{ upload_id: string }>>()
        .mockRejectedValue(new ApiError("down", "internal", 500)),
      isPending: false,
    };
    useUploadDocumentFileMock.mockReturnValue(upload);
    renderCard(documentMessage({ ...DOC, viewer_can_upload_version: true }));

    fireEvent.click(screen.getByRole("button", { name: "Tải lên phiên bản mới" }));
    const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    const pick = (name: string) =>
      fireEvent.change(document.querySelector<HTMLInputElement>('input[type="file"]')!, {
        target: { files: [new File(["x"], name, { type })] },
      });
    pick("v4-a.docx");
    fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));
    await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(1));
    const firstKey = upload.mutateAsync.mock.calls[0]![0].idempotencyKey;

    // A different file is a new intent: the key must not survive the pick,
    // or the server could replay the first upload for different bytes.
    pick("v4-b.docx");
    fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));
    await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(2));
    const secondKey = upload.mutateAsync.mock.calls[1]![0].idempotencyKey;
    expect(secondKey).not.toBe(firstKey);
  });

  it("keeps the version Idempotency-Key while retrying the same file (RFC-08)", async () => {
    const upload = {
      mutateAsync: vi
        .fn<(args: { file: File; idempotencyKey: string }) => Promise<{ upload_id: string }>>()
        .mockRejectedValue(new ApiError("down", "internal", 500)),
      isPending: false,
    };
    useUploadDocumentFileMock.mockReturnValue(upload);
    renderCard(documentMessage({ ...DOC, viewer_can_upload_version: true }));

    fireEvent.click(screen.getByRole("button", { name: "Tải lên phiên bản mới" }));
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
    const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    fireEvent.change(input, { target: { files: [new File(["a"], "v4.docx", { type })] } });
    fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));
    await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(1));
    // Same file, retried: the staged upload replays under the same key.
    fireEvent.click(screen.getByRole("button", { name: "Tải lên" }));
    await waitFor(() => expect(upload.mutateAsync).toHaveBeenCalledTimes(2));
    expect(upload.mutateAsync.mock.calls[1]![0].idempotencyKey).toBe(
      upload.mutateAsync.mock.calls[0]![0].idempotencyKey,
    );
  });

  it("toasts again on a second manage-access failure and opens the dialog on a later success (RFC-08)", async () => {
    const nav = fakeNav();
    const view = render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <ChatDocumentMessageRow
            workspaceId="ws1"
            roomId="room1"
            message={documentMessage({ ...DOC, viewer_can_manage: true })}
            senderLabel="Bình"
            isOwn={false}
            showSenderName={false}
            compactTop={false}
            showAvatar={false}
          />
        </WorkspaceProvider>,
        nav,
      ),
    );
    const rerender = () =>
      view.rerender(
        wrapWithNav(
          <WorkspaceProvider workspace={workspace} user={user}>
            <ChatDocumentMessageRow
              workspaceId="ws1"
              roomId="room1"
              message={documentMessage({ ...DOC, viewer_can_manage: true })}
              senderLabel="Bình"
              isOwn={false}
              showSenderName={false}
              compactTop={false}
              showAvatar={false}
            />
          </WorkspaceProvider>,
          nav,
        ),
      );

    // First failure: one toast, and the query is switched back off so the
    // card does not hammer the detail read.
    useDocumentMock.mockReturnValue({ data: undefined, isError: true, error: new ApiError("down", "internal", 500) });
    fireEvent.click(screen.getByRole("button", { name: "Quản lý quyền truy cập" }));
    rerender();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(useDocumentMock).toHaveBeenLastCalledWith("ws1", "doc1", { enabled: false });

    // Second failure toasts again — the flag resets on each click.
    useDocumentMock.mockReturnValue({
      data: undefined,
      isError: true,
      error: new ApiError("down again", "internal", 500),
    });
    fireEvent.click(screen.getByRole("button", { name: "Quản lý quyền truy cập" }));
    rerender();
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(2));

    // A later success still opens the share dialog.
    useDocumentMock.mockReturnValue({ data: { id: "doc1", title: "Báo cáo Q3" }, isError: false });
    fireEvent.click(screen.getByRole("button", { name: "Quản lý quyền truy cập" }));
    rerender();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

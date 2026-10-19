import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { wrapWithNav, fakeNav } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatDocumentMessageRow, type ChatDocumentDesktopOpen } from "./chat-document-message-row";

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

  it("renders a neutral filename card when the document block is absent", () => {
    renderCard(documentMessage(undefined));
    expect(screen.getByText("Báo cáo Q3.docx")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mở trong Tài liệu/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Phiên bản/)).not.toBeInTheDocument();
  });

  it("renders the locked card for a viewer without access", () => {
    renderCard(documentMessage({ document_id: "doc1", viewer_has_access: false }));
    expect(screen.getByText("Không có quyền truy cập")).toBeInTheDocument();
    // The block carries nothing else: no title, no actions, no request button
    // while CHAT_DOCUMENT_ACCESS_REQUESTS_ENABLED is off.
    expect(screen.queryByText("Báo cáo Q3")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders the full card and opens the document from the title", () => {
    const nav = renderCard(documentMessage(DOC));
    expect(screen.getByRole("button", { name: "Mở trong Tài liệu: Báo cáo Q3" })).toBeInTheDocument();
    expect(screen.getByText("Phiên bản 3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mở trong Tài liệu: Báo cáo Q3" }));
    expect(nav.push).toHaveBeenCalledWith("/acme/team/documents/doc1");
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
});

import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import type { User, Workspace } from "@uniwork/core/types";
import { WorkspaceProvider } from "../layout/workspace-context";
import { fakeNav, requestMock, wrapWithNav } from "../test/api-mock";
import { DocumentLockedCard } from "./document-locked-card";

// DOC7-W01 (access addendum §3.1-3.4): the member card never shows anything
// of the document, sends one request, and reads the server's answers about
// the requester's own row (409 pending, 429 cooldown) as states, not errors.

const { t } = initI18n();
const WS = "ws1";
const K = (k: string, o?: Record<string, unknown>) => t(`documents.access_request.${k}`, o);
const FLAG = "uniwork_document_access_request_sent:d1";
const SEND_PATH = "/api/v1/documents/d1/access-requests";

const user: User = {
  id: "u1",
  email: "an@acme.vn",
  display_name: "An",
  onboarded_at: "2026-08-25T00:00:00Z",
  email_verified_at: "2026-08-25T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};
const workspace: Workspace = {
  id: WS,
  slug: "team",
  name: "Team",
  organization_id: "o1",
  organization_slug: "acme",
  organization_name: "Acme",
};

function renderMember(over: { source?: { kind: "task"; id: string } | null; onRetryOpen?: () => void; onBack?: () => void } = {}) {
  const onRetryOpen = over.onRetryOpen ?? vi.fn();
  const onBack = over.onBack ?? vi.fn();
  render(
    wrapWithNav(
      <DocumentLockedCard
        variant="member"
        wsId={WS}
        documentId="d1"
        source={over.source ?? null}
        onRetryOpen={onRetryOpen}
        onBack={onBack}
      />,
    ),
  );
  return { onRetryOpen, onBack };
}

const sendButton = () => screen.getByRole("button", { name: K("send") });
const messageBox = () => screen.getByRole("textbox", { name: K("message_label") });
// The flag holds the expiry (send time + 24 h); the note shows the send time in the reader's clock.
const sentTime = (at: number) => new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
const sendCalls = () => requestMock.mock.calls.filter(([path]) => path === SEND_PATH);

beforeEach(() => {
  localStorage.clear();
  requestMock.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
  localStorage.clear();
});

describe("DocumentLockedCard variant=member", () => {
  it("is a section with a real heading and the neutral copy, and asks for nothing on mount", () => {
    renderMember();
    const heading = screen.getByRole("heading", { name: K("locked_title") });
    expect(heading.closest("section")).not.toBeNull();
    expect(screen.getByText(K("locked_body"))).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: t("documents.share.level_view") })).toBeChecked();
    expect(screen.getByRole("radio", { name: t("documents.share.level_edit") })).not.toBeChecked();
    expect(screen.getByText(K("message_counter", { count: 0 }))).toBeInTheDocument();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("sends the level, the trimmed message and the task source, then shows the sent status without a send button", async () => {
    let resolve!: (v: unknown) => void;
    requestMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderMember({ source: { kind: "task", id: "01J8X4T9K0N1P2Q3R4S5T6V7W8" } });

    fireEvent.click(screen.getByRole("radio", { name: t("documents.share.level_edit") }));
    fireEvent.change(messageBox(), { target: { value: "  cần sửa báo cáo  " } });
    expect(screen.getByText(K("message_counter", { count: 15 }))).toBeInTheDocument();
    expect(messageBox()).toHaveAttribute("aria-describedby", expect.stringContaining("counter"));
    fireEvent.click(sendButton());

    // Awaits the server: the button says it is sending and refuses a second click.
    const pending = await screen.findByRole("button", { name: K("sending") });
    expect(pending).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByText(K("sent"))).toBeNull();
    expect(sendCalls()).toHaveLength(1);
    expect(sendCalls()[0]![1]).toMatchObject({
      method: "POST",
      body: { requested_level: "edit", message: "cần sửa báo cáo", source_kind: "task", source_id: "01J8X4T9K0N1P2Q3R4S5T6V7W8" },
    });

    await act(async () => resolve({ status: "sent" }));
    expect(await screen.findByRole("status")).toHaveTextContent(K("sent"));
    expect(screen.queryByRole("button", { name: K("send") })).toBeNull();
    expect(localStorage.getItem(FLAG)).not.toBeNull();
    // Level and message stay readable, not editable.
    expect(screen.queryByRole("textbox", { name: K("message_label") })).toBeNull();
    expect(screen.getByText("cần sửa báo cáo")).toBeInTheDocument();
    // The recap has its own label: "(optional)" makes no sense on a sent message.
    const recap = screen.getByRole("status");
    expect(recap).toHaveTextContent(K("sent_message_label"));
    expect(recap).not.toHaveTextContent(K("message_label"));
    expect(K("sent_message_label")).not.toMatch(/optional|không bắt buộc/i);
  });

  it("sends no source and no empty message when there is none", async () => {
    requestMock.mockResolvedValue({ status: "sent" });
    renderMember();
    fireEvent.click(sendButton());
    await screen.findByRole("status");
    expect(sendCalls()[0]![1]).toMatchObject({ body: { requested_level: "view" } });
    expect(sendCalls()[0]![1].body).not.toHaveProperty("message");
    expect(sendCalls()[0]![1].body).not.toHaveProperty("source_kind");
  });

  it("reads 409 access_request_pending as already pending, with no send button", async () => {
    requestMock.mockRejectedValue(new ApiError("pending", "access_request_pending", 409));
    renderMember();
    fireEvent.click(sendButton());
    expect(await screen.findByRole("status")).toHaveTextContent(K("already_pending"));
    expect(screen.queryByRole("button", { name: K("send") })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // The server set the device flag back even though it had been lost.
    expect(localStorage.getItem(FLAG)).not.toBeNull();
  });

  it("after an expired request the form is usable at once: send -> sent, no cooldown text", async () => {
    // Expiry (30 days) is not a decline: the 24 h device flag is long gone and
    // the server accepts a new request without any wait.
    localStorage.setItem(FLAG, String(Date.now() - 1000));
    requestMock.mockResolvedValue({ status: "sent" });
    renderMember();
    expect(screen.queryByText(K("already_pending"))).toBeNull();
    expect(sendButton()).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sendButton());
    expect(await screen.findByRole("status")).toHaveTextContent(K("sent"));
    expect(sendCalls()).toHaveLength(1);
    expect(screen.queryByText(/phút|min\b/)).toBeNull();
  });

  it("shows a device 'sent' flag as a note but keeps the form usable: the server's answer wins", async () => {
    localStorage.setItem(FLAG, String(Date.now() + 3_600_000));
    requestMock.mockResolvedValue({ status: "sent" });
    renderMember();
    // Past tense with the send time: it must not read as "waiting" above a usable form.
    const note = screen.getByRole("status");
    expect(note).toHaveTextContent(K("sent_earlier", { time: sentTime(Date.now() + 3_600_000 - 86_400_000) }));
    expect(note).not.toHaveTextContent(K("already_pending"));
    expect(sendButton()).not.toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sendButton());
    // The server would accept (the earlier request was handled elsewhere): sent, not pending.
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(K("sent")));
    expect(sendCalls()).toHaveLength(1);
    expect(screen.queryByRole("button", { name: K("send") })).toBeNull();
  });

  it("a device flag followed by a 409 lands on the pending state", async () => {
    localStorage.setItem(FLAG, String(Date.now() + 3_600_000));
    requestMock.mockRejectedValue(new ApiError("pending", "access_request_pending", 409));
    renderMember();
    fireEvent.click(sendButton());
    await waitFor(() => expect(screen.queryByRole("button", { name: K("send") })).toBeNull());
    expect(screen.getByRole("status")).toHaveTextContent(K("already_pending"));
  });

  it("a device flag followed by a 429 cooldown shows the cooldown, not the pending note", async () => {
    localStorage.setItem(FLAG, String(Date.now() + 3_600_000));
    requestMock.mockRejectedValue(
      new ApiError("cooldown", "access_request_cooldown", 429, undefined, { retry_after_seconds: 600 }),
    );
    renderMember();
    fireEvent.click(sendButton());
    expect(await screen.findByText(K("cooldown", { minutes: 10 }))).toBeInTheDocument();
    expect(screen.queryByText(K("already_pending"))).toBeNull();
  });

  it("shows the cooldown in whole minutes, keeps send aria-disabled, then re-enables it without a reload", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    requestMock.mockRejectedValue(
      new ApiError("cooldown", "access_request_cooldown", 429, undefined, { retry_after_seconds: 61 }),
    );
    renderMember();
    fireEvent.click(sendButton());
    expect(await screen.findByText(K("cooldown", { minutes: 2 }))).toBeInTheDocument();
    expect(sendButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sendButton());
    expect(sendCalls()).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(62_000);
    });
    await waitFor(() => expect(sendButton()).not.toHaveAttribute("aria-disabled", "true"));
    expect(screen.queryByText(K("cooldown", { minutes: 2 }))).toBeNull();
    expect(localStorage.getItem(FLAG)).toBeNull();
  });

  it("announces the cooldown politely (role=status), keeping role=alert for failures", async () => {
    requestMock.mockRejectedValue(
      new ApiError("cooldown", "access_request_cooldown", 429, undefined, { retry_after_seconds: 61 }),
    );
    renderMember();
    fireEvent.click(sendButton());
    const text = await screen.findByText(K("cooldown", { minutes: 2 }));
    expect(text.closest("[role]")).toHaveAttribute("role", "status");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("reads a 429 without the cooldown code as the rate limiter", async () => {
    requestMock.mockRejectedValue(new ApiError("slow down", "rate_limited", 429));
    renderMember();
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(K("rate_limited"));
  });

  it("keeps the typed level and message after a failed send and offers it again", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("boom", "internal", 500));
    renderMember();
    fireEvent.click(screen.getByRole("radio", { name: t("documents.share.level_edit") }));
    fireEvent.change(messageBox(), { target: { value: "cần gấp" } });
    fireEvent.click(sendButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(K("send_failed"));
    expect(messageBox()).toHaveValue("cần gấp");
    expect(screen.getByRole("radio", { name: t("documents.share.level_edit") })).toBeChecked();

    requestMock.mockResolvedValueOnce({ status: "sent" });
    fireEvent.click(sendButton());
    expect(await screen.findByRole("status")).toHaveTextContent(K("sent"));
  });

  it("blocks a message over 500 characters before it reaches the server", () => {
    renderMember();
    fireEvent.change(messageBox(), { target: { value: "x".repeat(501) } });
    expect(screen.getByText(K("message_too_long"))).toBeInTheDocument();
    expect(messageBox()).toHaveAttribute("aria-invalid", "true");
    expect(sendButton()).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(sendButton());
    expect(sendCalls()).toHaveLength(0);
  });

  it("offers to try opening again and to go back", () => {
    const { onRetryOpen, onBack } = renderMember();
    fireEvent.click(screen.getByRole("button", { name: K("retry_open") }));
    expect(onRetryOpen).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: t("documents.detail.back_to_library") }));
    expect(onBack).toHaveBeenCalled();
  });

  it("puts the send button first among the actions and keeps 44px coarse targets", () => {
    renderMember();
    const buttons = screen.getAllByRole("button");
    expect(buttons[0]).toBe(sendButton());
    for (const b of buttons) expect(b.className).toContain("pointer-coarse:min-h-11");
    for (const radio of screen.getAllByRole("radio")) {
      expect(radio.closest("label")?.className ?? "").toContain("pointer-coarse:min-h-11");
    }
  });
});

describe("DocumentLockedCard variant=admin", () => {
  it("keeps the restricted copy and offers Manage access once the admin summary answers", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1/admin-summary") {
        return Promise.resolve({ id: "d1", title: "Lương 2026", kind: "page", visibility: "restricted", organization_id: "o1", revision: "4" });
      }
      return Promise.resolve({});
    });
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <DocumentLockedCard variant="admin" wsId={WS} documentId="d1" onBack={vi.fn()} />
        </WorkspaceProvider>,
      ),
    );
    // An admin never had this document: it is restricted, not revoked.
    expect(screen.getByRole("heading", { name: K("admin_locked_title") })).toBeInTheDocument();
    expect(screen.getByText(K("admin_locked_body"))).toBeInTheDocument();
    expect(screen.queryByText(t("documents.detail.revoked_title"))).toBeNull();
    expect(screen.queryByText(t("documents.detail.revoked_description"))).toBeNull();
    expect(await screen.findByRole("button", { name: t("documents.share.admin_manage_button") })).toBeInTheDocument();
    // Admins manage but never read: the title the summary carries is not on the card.
    expect(screen.queryByText("Lương 2026")).toBeNull();
    expect(screen.queryByRole("button", { name: K("send") })).toBeNull();
  });

  it("opens Share at the requests section from ?access=requests and drops the parameter (DOC7-W02, §2.5)", async () => {
    requestMock.mockImplementation((path: string) => {
      if (path === "/api/v1/documents/d1/admin-summary") {
        return Promise.resolve({ id: "d1", title: "Lương 2026", kind: "page", visibility: "restricted", organization_id: "o1", revision: "4" });
      }
      if (path === "/api/v1/documents/d1/access-requests") return Promise.resolve({ requests: [] });
      if (path === "/api/v1/documents/d1/shares") {
        return Promise.resolve({ my_level: "", admin_scope: true, acl_owner: null, shares: [], links: [] });
      }
      return Promise.resolve({});
    });
    const nav = fakeNav("/acme/team/documents/d1?access=requests&x=1");
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <DocumentLockedCard variant="admin" wsId={WS} documentId="d1" onBack={vi.fn()} />
        </WorkspaceProvider>,
        nav,
      ),
    );
    const dialog = await screen.findByRole("dialog", { name: t("documents.share.title") });
    expect(
      await within(dialog).findByRole("heading", { name: t("documents.access_request.section_title", { count: 0 }) }),
    ).toBeInTheDocument();
    await waitFor(() => expect(nav.replace).toHaveBeenCalledWith("/acme/team/documents/d1?x=1"));
  });

  it("shows no Manage access when the admin summary is refused", async () => {
    requestMock.mockRejectedValue(new ApiError("forbidden", "forbidden", 403));
    render(
      wrapWithNav(
        <WorkspaceProvider workspace={workspace} user={user}>
          <DocumentLockedCard variant="admin" wsId={WS} documentId="d1" onBack={vi.fn()} />
        </WorkspaceProvider>,
      ),
    );
    await waitFor(() => expect(requestMock).toHaveBeenCalled());
    expect(screen.queryByRole("button", { name: t("documents.share.admin_manage_button") })).toBeNull();
  });
});

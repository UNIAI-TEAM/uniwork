import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { clearDocumentAccessRequestSent } from "@uniwork/core/documents/hooks-access-requests";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { ChatDocumentRequestAccess } from "./chat-document-actions";

vi.mock("sonner", () => ({
  toast: { error: vi.fn(), message: vi.fn(), info: vi.fn() },
}));

import { toast } from "sonner";

// UNI-1966 (L4 / S7): the locked chat card asks for view access through the
// same route and copy as the document page (POST /documents/{id}/access-requests).

const { t } = initI18n();
const SEND_PATH = "/api/v1/documents/doc1/access-requests";
const K = (k: string, o?: Record<string, unknown>) => t(`documents.access_request.${k}`, o);

const button = () => screen.getByRole("button", { name: t("chat.document_request_access") });
const sendCalls = () => requestMock.mock.calls.filter(([path]) => path === SEND_PATH);

function renderButton() {
  render(wrap(<ChatDocumentRequestAccess workspaceId="ws1" documentId="doc1" />));
}

beforeEach(() => {
  localStorage.clear();
  requestMock.mockReset();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.message).mockClear();
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("ChatDocumentRequestAccess", () => {
  it("sends one view request with no message or source, then shows the sent status in place of the button", async () => {
    requestMock.mockResolvedValue({ status: "sent" });
    renderButton();
    expect(requestMock).not.toHaveBeenCalled();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(K("sent")));
    expect(sendCalls()).toHaveLength(1);
    expect(sendCalls()[0]![1]).toMatchObject({ method: "POST", body: { requested_level: "view" } });
    expect(Object.keys((sendCalls()[0]![1] as { body: object }).body)).toEqual(["requested_level"]);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("has the status region before the send resolves and keeps keyboard focus off the body after", async () => {
    let resolve!: (v: unknown) => void;
    requestMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderButton();
    // A live region created together with its text is not announced: it must be there first.
    const status = screen.getByRole("status");
    expect(status).toBeEmptyDOMElement();
    button().focus();
    fireEvent.click(button());
    await waitFor(() => expect(button()).toHaveAttribute("aria-disabled", "true"));
    resolve({ status: "sent" });
    await waitFor(() => expect(status).toHaveTextContent(K("sent")));
    expect(screen.getByRole("status")).toBe(status);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(status);
  });

  it("mounts with a fresh flag: the earlier-request note is visible AND the button is present, a click still sends", async () => {
    const at = Date.now() - 3600_000;
    localStorage.setItem("uniwork_document_access_request_sent:doc1", String(at + 24 * 3600_000));
    requestMock.mockResolvedValue({ status: "sent" });
    renderButton();
    const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(new Date(at));
    expect(screen.getByRole("status")).toHaveTextContent(K("sent_earlier", { time }));
    expect(button()).toBeInTheDocument();
    expect(document.activeElement).toBe(document.body);
    expect(requestMock).not.toHaveBeenCalled();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(K("sent")));
    expect(sendCalls()).toHaveLength(1);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("stops claiming a request waits once a decision clears the flag, for a send made in this mount too", async () => {
    requestMock.mockResolvedValue({ status: "sent" });
    renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(K("sent")));
    act(() => clearDocumentAccessRequestSent("doc1"));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(button()).toBeInTheDocument();
  });

  it("drops the earlier-request note when the flag is cleared while mounted", () => {
    localStorage.setItem("uniwork_document_access_request_sent:doc1", String(Date.now() + 3600_000));
    renderButton();
    expect(screen.getByRole("status")).not.toBeEmptyDOMElement();
    act(() => clearDocumentAccessRequestSent("doc1"));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(button()).toBeInTheDocument();
  });

  it("leaves focus where the person moved it while the request was in flight", async () => {
    let resolve!: (v: unknown) => void;
    requestMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    render(
      wrap(
        <>
          <ChatDocumentRequestAccess workspaceId="ws1" documentId="doc1" />
          <input aria-label="composer" />
        </>,
      ),
    );
    button().focus();
    fireEvent.click(button());
    await waitFor(() => expect(button()).toHaveAttribute("aria-disabled", "true"));
    const composer = screen.getByLabelText("composer");
    composer.focus();
    resolve({ status: "sent" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(K("sent")));
    expect(document.activeElement).toBe(composer);
  });

  it("ignores an expired device flag and offers the button", () => {
    localStorage.setItem("uniwork_document_access_request_sent:doc1", String(Date.now() - 1000));
    renderButton();
    expect(button()).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("does not send twice while a request is in flight", async () => {
    let resolve!: (v: unknown) => void;
    requestMock.mockImplementation(() => new Promise((r) => { resolve = r; }));
    renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(button()).toHaveAttribute("aria-disabled", "true"));
    fireEvent.click(button());
    fireEvent.click(button());
    expect(sendCalls()).toHaveLength(1);
    resolve({ status: "sent" });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(K("sent")));
    expect(sendCalls()).toHaveLength(1);
  });

  it("reads 409 access_request_pending as 'already waiting', not as a failure", async () => {
    requestMock.mockRejectedValue(new ApiError("pending", "access_request_pending", 409));
    renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(K("already_pending")));
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("toasts the cooldown in minutes (fields.retry_after_seconds, rounded up) and keeps the button", async () => {
    requestMock.mockRejectedValue(
      new ApiError("cooldown", "access_request_cooldown", 429, undefined, { retry_after_seconds: 2400 }),
    );
    renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(K("cooldown", { minutes: 40 })));
    expect(button()).not.toHaveAttribute("aria-disabled");
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it("toasts the limiter on a 429 without the cooldown code", async () => {
    requestMock.mockRejectedValue(new ApiError("slow down", "rate_limited", 429));
    renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(K("rate_limited")));
    expect(button()).toBeInTheDocument();
  });

  it.each([
    ["a 5xx", new ApiError("boom", "internal", 500)],
    ["a 404 (documents flag off at the caller's organization)", new ApiError("nf", "not_found", 404)],
    ["a network error", new Error("offline")],
  ])("toasts the generic failure for %s and allows another try", async (_label, err) => {
    requestMock.mockRejectedValueOnce(err).mockResolvedValueOnce({ status: "sent" });
    renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(K("send_failed")));
    fireEvent.click(button());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(K("sent")));
    expect(sendCalls()).toHaveLength(2);
  });

  it("treats an answer that is not the sent status as a failure, never as sent", async () => {
    requestMock.mockResolvedValue({ unexpected: true });
    renderButton();
    fireEvent.click(button());
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(K("send_failed")));
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });
});

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { initI18n } from "@uniwork/core/i18n";
import { requestMock, wrap } from "../test/api-mock";
import { DocumentTemplateWidenDialog } from "./document-template-widen-dialog";
import { useTemplateCommands } from "./use-template-commands";

// Marking a restricted document as a template opens it to the workspace, so
// nothing is sent until the person confirms. The transport is mocked, so the
// real schema and hooks stay in the loop.

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn(), dismiss: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const { t } = initI18n();

const WS = "ws1";
const DOC = { id: "d1", title: "Hợp đồng" };

function documentBody(over: Record<string, unknown> = {}) {
  return {
    document: {
      id: "d1",
      organization_id: "org1",
      workspace_id: WS,
      kind: "file",
      title: "Hợp đồng",
      format: "docx",
      visibility: "workspace",
      revision: "2",
      current_version: 1,
      position: 0,
      my_level: "manage",
      created_at: "2026-10-27T01:00:00Z",
      updated_at: "2026-10-27T02:00:00Z",
      template_marked_at: "2026-10-27T03:00:00Z",
      ...over,
    },
  };
}

const posts = () => requestMock.mock.calls.filter(([, init]) => (init as { method?: string } | undefined)?.method === "POST");

function renderDialog(onOpenChange = vi.fn()) {
  render(wrap(<DocumentTemplateWidenDialog open onOpenChange={onOpenChange} wsId={WS} doc={DOC} />));
  return onOpenChange;
}

beforeEach(() => {
  requestMock.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

describe("DocumentTemplateWidenDialog", () => {
  it("sends the widening POST once, even on a double click", async () => {
    requestMock.mockImplementation(async () => documentBody());
    const onOpenChange = renderDialog();
    expect(screen.getByText(t("documents.templates.widen.title"))).toBeTruthy();
    const confirm = screen.getByRole("button", { name: t("documents.templates.widen.confirm") });
    fireEvent.click(confirm);
    fireEvent.click(confirm);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(posts()).toHaveLength(1);
    expect(posts()[0]![0]).toBe("/api/v1/documents/d1/template");
    expect(posts()[0]![1]).toMatchObject({ method: "POST", body: { widen_to_workspace: true } });
    expect(toast.success).toHaveBeenCalledWith(t("documents.templates.marked", { title: "Hợp đồng" }));
  });

  it("sends nothing on cancel", () => {
    const onOpenChange = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: t("common.cancel") }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("keeps the dialog and says why when the server refuses", async () => {
    requestMock.mockRejectedValue(new ApiError("", "internal", 500));
    const onOpenChange = renderDialog();
    fireEvent.click(screen.getByRole("button", { name: t("documents.templates.widen.confirm") }));
    expect(await screen.findByText(t("documents.templates.mark_failed"))).toBeTruthy();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText(t("documents.templates.widen.title"))).toBeTruthy();
  });
});

function Harness({ visibility }: { visibility: string }) {
  const commands = useTemplateCommands(WS);
  return (
    <>
      <button type="button" onClick={() => commands.onMarkTemplate({ ...DOC, visibility } as never)}>
        mark
      </button>
      <button type="button" onClick={() => commands.onUnmarkTemplate({ ...DOC, visibility } as never)}>
        unmark
      </button>
      {commands.dialog}
    </>
  );
}

describe("useTemplateCommands", () => {
  it("marks a workspace document straight away, with no body, then toasts", async () => {
    requestMock.mockImplementation(async () => documentBody());
    render(wrap(<Harness visibility="workspace" />));
    fireEvent.click(screen.getByText("mark"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.templates.marked", { title: "Hợp đồng" })));
    expect(posts()).toHaveLength(1);
    expect((posts()[0]![1] as { body?: unknown }).body).toBeUndefined();
    expect(screen.queryByText(t("documents.templates.widen.title"))).toBeNull();
  });

  it("opens the confirmation for a restricted document and sends nothing yet", () => {
    render(wrap(<Harness visibility="restricted" />));
    fireEvent.click(screen.getByText("mark"));
    expect(screen.getByText(t("documents.templates.widen.title"))).toBeTruthy();
    expect(requestMock).not.toHaveBeenCalled();
  });

  it("removes the mark with DELETE and toasts", async () => {
    requestMock.mockImplementation(async () => documentBody({ template_marked_at: null }));
    render(wrap(<Harness visibility="workspace" />));
    fireEvent.click(screen.getByText("unmark"));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(t("documents.templates.unmarked", { title: "Hợp đồng" })));
    expect(requestMock.mock.calls[0]![0]).toBe("/api/v1/documents/d1/template");
    expect(requestMock.mock.calls[0]![1]).toMatchObject({ method: "DELETE" });
  });

  it("shows the server's message when a mark is refused", async () => {
    requestMock.mockRejectedValue(new ApiError("Tài liệu đã ở thùng rác", "document_deleted", 409));
    render(wrap(<Harness visibility="workspace" />));
    fireEvent.click(screen.getByText("mark"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Tài liệu đã ở thùng rác"));
  });

  it("says nothing changed when unmark fails", async () => {
    requestMock.mockRejectedValue(new ApiError("", "internal", 500));
    render(wrap(<Harness visibility="workspace" />));
    fireEvent.click(screen.getByText("unmark"));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(t("documents.templates.unmark_failed")));
  });
});

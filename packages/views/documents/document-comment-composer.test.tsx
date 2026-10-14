import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import { useDocumentCommentDraftStore } from "@uniwork/core/documents/comment-drafts";
import { initI18n } from "@uniwork/core/i18n";
import type { User } from "@uniwork/core/types";
import { requestMock } from "../test/request-mock";
import { DocumentCommentBody, mentionNames } from "./document-comment-body";
import { DocumentCommentComposer, type SendOutcome } from "./document-comment-composer";
import { K } from "./document-comments-keys";
import { mentionToken } from "./use-mention-picker";

// The composer and its S14 mention picker, and the §4.2 body renderer.

const { t } = initI18n();
const DOC = "d1";
const AN = "01J8X4USR0000000000000000A";
const BINH = "01J8X4USR0000000000000000B";

const me: User = {
  id: "01J8X4USR0000000000000000Z",
  email: "me@example.com",
  display_name: "Minh",
  onboarded_at: "2026-09-01T00:00:00Z",
  email_verified_at: "2026-09-01T00:00:00Z",
  onboarding_questionnaire: {},
  locale: "vi",
};

function renderComposer(onSend: (body: string) => Promise<SendOutcome> = () => Promise.resolve("sent"), onCancel?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  render(
    <QueryClientProvider client={client}>
      <DocumentCommentComposer
        wsId="ws1"
        documentId={DOC}
        orgId="org1"
        parentId={onCancel ? "p1" : undefined}
        placeholderKey={K.collabComposerDiscussion}
        deletedKey={K.collabDiscussionDeleted}
        onSend={onSend}
        onCancel={onCancel}
        testId="composer"
      />
    </QueryClientProvider>,
  );
  return screen.getByRole("textbox", { name: t(K.collabComposerDiscussion) }) as HTMLTextAreaElement;
}

const type = (box: HTMLTextAreaElement, value: string) => fireEvent.change(box, { target: { value } });

beforeEach(() => {
  resetAuthStoreForTests();
  setSessionUser(me);
  requestMock.mockReset();
  useDocumentCommentDraftStore.setState({ drafts: {}, ownerId: null });
});

describe("S14 mention picker", () => {
  it("offers only the document's mention candidates, as an APG combobox", async () => {
    requestMock.mockImplementation((path: string) =>
      path.startsWith(`/api/v1/documents/${DOC}/mention-candidates`)
        ? Promise.resolve({ candidates: [{ user_id: AN, display_name: "An", email: "an@example.com" }, { user_id: BINH, display_name: "Bình" }] })
        : Promise.reject(new ApiError("unexpected", "not_found", 404)),
    );
    const box = renderComposer();
    expect(box).not.toHaveAttribute("role", "combobox");
    type(box, "Nhờ @");
    const listbox = await screen.findByRole("listbox", { name: t(K.collabMentionLabel) });
    const options = await within(listbox).findAllByRole("option", { name: /An|Bình/ });
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("an@example.com");
    expect(options[1]).toHaveTextContent("Bình");
    // Only the candidates route was asked; no workspace member list.
    expect(requestMock.mock.calls.every(([p]) => String(p).includes("/mention-candidates"))).toBe(true);
    const combo = screen.getByRole("combobox");
    expect(combo).toHaveAttribute("aria-expanded", "true");
    expect(combo).toHaveAttribute("aria-controls", listbox.id);
    expect(combo).toHaveAttribute("aria-activedescendant", options[0]!.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText(t(K.collabMentionCount, { count: 2 }))).toHaveAttribute("aria-live", "polite");

    fireEvent.keyDown(combo, { key: "ArrowDown" });
    expect(combo).toHaveAttribute("aria-activedescendant", options[1]!.id);
    fireEvent.keyDown(combo, { key: "Enter" });
    expect(box).toHaveValue(`Nhờ ${mentionToken({ user_id: BINH, display_name: "Bình" })} `);
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes on Escape and keeps what was typed as plain text", async () => {
    requestMock.mockResolvedValue({ candidates: [{ user_id: AN, display_name: "An" }] });
    const box = renderComposer();
    type(box, "@An");
    await screen.findByRole("option", { name: /An/ });
    fireEvent.keyDown(box, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(box).toHaveValue("@An");
    expect(box).not.toHaveAttribute("role");
  });

  it("says when no one else can read the document, and when nobody matches", async () => {
    requestMock.mockResolvedValue({ candidates: [] });
    const box = renderComposer();
    type(box, "@");
    expect(await screen.findByText(t(K.collabMentionNoCandidates))).toHaveAttribute("aria-disabled", "true");
    type(box, "@zz");
    expect(await screen.findByText(t(K.collabMentionNoMatch, { query: "zz" }))).toHaveAttribute("role", "option");
  });

  it("offers Retry inside the listbox when the people cannot load", async () => {
    requestMock.mockRejectedValueOnce(new ApiError("x", "internal", 500)).mockResolvedValue({ candidates: [{ user_id: AN, display_name: "An" }] });
    const box = renderComposer();
    type(box, "@");
    expect(await screen.findByText(t(K.collabMentionError))).toBeInTheDocument();
    const retry = screen.getByRole("option", { name: t(K.collabRetry) });
    expect(box).toHaveAttribute("aria-activedescendant", retry.id);
    fireEvent.keyDown(box, { key: "Enter" });
    expect(await screen.findByRole("option", { name: /An/ })).toBeInTheDocument();
  });

  it("does not send the half-typed @query on Ctrl/Cmd+Enter while the picker is open", async () => {
    requestMock.mockResolvedValue({ candidates: [{ user_id: AN, display_name: "An" }] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = renderComposer(onSend);
    type(box, "Nhờ @A");
    await screen.findByRole("option", { name: /An/ });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    fireEvent.keyDown(box, { key: "Enter", metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue("Nhờ @A");
    // Closed, the same key sends as before.
    fireEvent.keyDown(box, { key: "Escape" });
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Nhờ @A"));
  });

  it("opens the listbox upward when the viewport below the composer cannot hold it, and caps it to the room", async () => {
    requestMock.mockResolvedValue({ candidates: [{ user_id: AN, display_name: "An" }] });
    const field = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: window.innerHeight - 90, bottom: window.innerHeight - 20, left: 0, right: 300, width: 300, height: 70, x: 0, y: window.innerHeight - 90, toJSON: () => ({}),
    });
    try {
      const box = renderComposer();
      type(box, "@");
      const listbox = await screen.findByRole("listbox", { name: t(K.collabMentionLabel) });
      expect(listbox).toHaveAttribute("data-placement", "top");
      expect(listbox.className).toContain("bottom-full");
      expect(listbox.className).not.toContain("top-full");
    } finally {
      field.mockRestore();
    }
  });

  it("keeps the listbox below the composer when there is room", async () => {
    requestMock.mockResolvedValue({ candidates: [{ user_id: AN, display_name: "An" }] });
    const field = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({
      top: 40, bottom: 110, left: 0, right: 300, width: 300, height: 70, x: 0, y: 40, toJSON: () => ({}),
    });
    try {
      const box = renderComposer();
      type(box, "@");
      const listbox = await screen.findByRole("listbox", { name: t(K.collabMentionLabel) });
      expect(listbox).toHaveAttribute("data-placement", "bottom");
      expect(listbox.className).toContain("top-full");
    } finally {
      field.mockRestore();
    }
  });

  it("escapes brackets in the token label", () => {
    expect(mentionToken({ user_id: AN, display_name: "An [PM] (HN)" })).toBe(`[@An \\[PM\\] \\(HN\\)](mention://member/${AN})`);
  });
});

describe("composer rows", () => {
  it("sends with Ctrl+Enter, clears once accepted", async () => {
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = renderComposer(onSend);
    type(box, "Xin chào");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledWith("Xin chào"));
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("says it is sending, names it for screen readers, and blocks a second send meanwhile", async () => {
    let finish: (outcome: SendOutcome) => void = () => {};
    const onSend = vi.fn(() => new Promise<SendOutcome>((resolve) => { finish = resolve; }));
    const box = renderComposer(onSend);
    type(box, "Đang gửi");
    const send = screen.getByTestId("composer-send");
    fireEvent.click(send);
    await waitFor(() => expect(send).toHaveTextContent(t(K.collabSending)));
    expect(send).toHaveAttribute("aria-disabled", "true");
    expect(screen.getAllByText(t(K.collabSending)).some((node) => box.getAttribute("aria-describedby")?.split(" ").includes(node.id))).toBe(true);
    fireEvent.click(send);
    expect(onSend).toHaveBeenCalledTimes(1);
    finish("sent");
    await waitFor(() => expect(box).toHaveValue(""));
    expect(send).toHaveTextContent(t(K.collabSend));
  });

  it("keeps the text and says so when sending fails", async () => {
    const box = renderComposer(() => Promise.resolve("failed"));
    type(box, "Giữ lại");
    fireEvent.click(screen.getByTestId("composer-send"));
    const problem = await screen.findByTestId("composer-problem");
    expect(problem).toHaveTextContent(t(K.collabSendFailed));
    expect(box).toHaveValue("Giữ lại");
    expect(box.getAttribute("aria-describedby")).toContain(problem.id);
  });

  it("offers to copy the text when the thread was deleted while writing", async () => {
    const box = renderComposer(() => Promise.resolve("target_deleted"));
    type(box, "Nội dung dài");
    fireEvent.click(screen.getByTestId("composer-send"));
    const problem = await screen.findByTestId("composer-problem");
    expect(problem).toHaveTextContent(t(K.collabDiscussionDeleted));
    expect(within(problem).getByRole("button", { name: t(K.collabCopyText) })).toBeInTheDocument();
    expect(box).toHaveValue("Nội dung dài");
  });

  it("asks before a cancelled draft is lost, Keep writing first", async () => {
    const onCancel = vi.fn();
    const box = renderComposer(undefined, onCancel);
    type(box, "Nháp");
    fireEvent.keyDown(box, { key: "Escape" });
    const dialog = await screen.findByRole("alertdialog");
    expect(within(dialog).getByRole("button", { name: t(K.collabKeepWriting) })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole("button", { name: t(K.collabDiscard) }));
    expect(onCancel).toHaveBeenCalled();
  });
});

describe("body renderer (§4.2)", () => {
  it("renders the Markdown subset, opens links outside, and shows anything else as typed", () => {
    render(
      <DocumentCommentBody
        names={mentionNames([])}
        body={"Dòng **đậm** và *nghiêng* với `mã`\ndòng hai https://example.com/a.\n\n<b>html</b> # tiêu đề [nhãn](https://uniwork.vn)"}
      />,
    );
    const body = screen.getByTestId("document-comment-body");
    expect(within(body).getByText("đậm").tagName).toBe("STRONG");
    expect(within(body).getByText("nghiêng").tagName).toBe("EM");
    expect(within(body).getByText("mã").tagName).toBe("CODE");
    expect(body.querySelectorAll("p")).toHaveLength(2);
    expect(body.querySelector("br")).not.toBeNull();
    const bare = within(body).getByRole("link", { name: "https://example.com/a" });
    expect(bare).toHaveAttribute("target", "_blank");
    expect(bare).toHaveAttribute("rel", "noopener noreferrer");
    expect(within(body).getByRole("link", { name: "nhãn" })).toHaveAttribute("href", "https://uniwork.vn");
    expect(body).toHaveTextContent("<b>html</b> # tiêu đề");
    expect(body.querySelector("b")).toBeNull();
  });

  it("folds a long body behind an expand toggle and unfolds it", () => {
    render(<DocumentCommentBody names={mentionNames([])} body={`${"Rất dài ".repeat(120)}`} />);
    const body = screen.getByTestId("document-comment-body");
    const toggle = screen.getByRole("button", { name: t(K.commentExpand) });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveAttribute("aria-controls", body.id);
    expect(body.className).toContain("max-h-40");
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: t(K.commentCollapse) })).toHaveAttribute("aria-expanded", "true");
    expect(body.className).not.toContain("max-h-40");
  });

  it("folds a body of many short lines, and leaves a short body unfolded", () => {
    const { unmount } = render(<DocumentCommentBody names={mentionNames([])} body={Array.from({ length: 9 }, (_, i) => `dòng ${i}`).join("\n")} />);
    expect(screen.getByRole("button", { name: t(K.commentExpand) })).toBeInTheDocument();
    unmount();
    render(<DocumentCommentBody names={mentionNames([])} body="Ngắn gọn" />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says a comment without text has none", () => {
    render(<DocumentCommentBody names={mentionNames([])} body={"  \n\n  "} />);
    expect(screen.getByText(t(K.commentPreviewEmpty))).toBeInTheDocument();
  });

  it("keeps a mention-looking URL inside code as code, not a chip", () => {
    render(<DocumentCommentBody names={mentionNames([])} body={`\`[@X](mention://member/${AN})\``} />);
    expect(document.querySelector("[data-mention-id]")).toBeNull();
  });
});

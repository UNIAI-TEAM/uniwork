import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { resetAuthStoreForTests, setSessionUser } from "@uniwork/core/auth";
import type React from "react";
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

// G8-18 (UNI-1413): mentions of people who cannot view the document. States F2-F4 + N1-N4 of the addendum.
describe("G8-18 mention without access", () => {
  const CUONG = "01J8X4USR0000000000000000C";
  const person = (id: string, name: string, canView = false) => ({ user_id: id, display_name: name, can_view: canView });
  const tok = (id: string, name: string) => mentionToken({ user_id: id, display_name: name });
  const shareAnswer = (id: string) => ({ share: { id: `s-${id}`, principal_type: "user", principal_id: id, level: "view" } });
  type Call = { method: string; path: string; body?: unknown };
  let calls: Call[];

  function installApi(opts: {
    candidates: unknown[];
    shareFails?: string[];
  }) {
    calls = [];
    requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) => {
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push({ method, path, body: init?.body });
      if (path.startsWith(`/api/v1/documents/${DOC}/mention-candidates`)) return Promise.resolve({ candidates: opts.candidates });
      if (method === "POST" && path === `/api/v1/documents/${DOC}/shares`) {
        const id = (init?.body as { principal_id: string }).principal_id;
        return opts.shareFails?.includes(id) ? Promise.reject(new ApiError("no", "forbidden", 403)) : Promise.resolve(shareAnswer(id));
      }
      return Promise.reject(new ApiError("unexpected", "not_found", 404));
    });
  }

  function mount(onSend: (b: string) => Promise<SendOutcome>, extra: Partial<React.ComponentProps<typeof DocumentCommentComposer>> = {}) {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <DocumentCommentComposer
          wsId="ws1" documentId={DOC} orgId="org1" placeholderKey={K.collabComposerDiscussion}
          deletedKey={K.collabDiscussionDeleted} onSend={onSend} testId="composer"
          canSeeMembers doc={{ my_level: "manage", owner_kind: undefined, admin_scope: undefined }} {...extra}
        />
      </QueryClientProvider>,
    );
    return screen.getByRole("textbox", { name: t(K.collabComposerDiscussion) }) as HTMLTextAreaElement;
  }

  /** Types `@`, waits for the listbox, picks the row named `name`. */
  async function pick(box: HTMLTextAreaElement, prefix: string, name: string) {
    type(box, `${prefix}@`);
    const option = await screen.findByRole("option", { name: new RegExp(name) });
    fireEvent.mouseDown(option);
    fireEvent.click(option);
  }
  const shareCalls = () => calls.filter((c) => c.method === "POST" && c.path.endsWith("/shares"));
  const dialog = () => screen.findByTestId("composer-mention-warn-dialog");
  const names = new Intl.ListFormat("vi", { style: "long", type: "conjunction" });

  it("asks the picker for include=no_access only when the caller may list members, and badges can_view=false with a lock and text", async () => {
    installApi({ candidates: [person(AN, "An"), person(BINH, "Bình", true)] });
    const box = mount(() => Promise.resolve("sent"));
    type(box, "@");
    await screen.findByRole("option", { name: /An/ });
    expect(calls.some((c) => c.path.includes("include=no_access"))).toBe(true);
    const badge = screen.getByTestId(`mention-candidate-no-access-${AN}`);
    expect(badge).toHaveTextContent(t(K.collabMentionNoAccessBadge));
    expect(badge.querySelector("svg")).not.toBeNull();
    expect(screen.queryByTestId(`mention-candidate-no-access-${BINH}`)).toBeNull();
  });

  it("does not ask for include=no_access when the caller cannot list members", async () => {
    installApi({ candidates: [person(AN, "An", true)] });
    const box = mount(() => Promise.resolve("sent"), { canSeeMembers: false });
    type(box, "@");
    await screen.findByRole("option", { name: /An/ });
    expect(calls.some((c) => c.path.includes("include="))).toBe(false);
  });

  it("shows the badge on the inserted chip too", async () => {
    installApi({ candidates: [person(AN, "An")] });
    const box = mount(() => Promise.resolve("sent"));
    await pick(box, "Nhờ ", "An");
    const chip = await screen.findByTestId(`composer-mention-chip-${AN}`);
    expect(chip).toHaveTextContent(t(K.collabMentionNoAccessBadge));
    expect(chip.querySelector("svg")).not.toBeNull();
  });

  it("F2: warns for one person, shares view with the fixed level, then sends ONE comment", async () => {
    installApi({ candidates: [person(AN, "An")] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = mount(onSend);
    await pick(box, "", "An");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    const dlg = await dialog();
    expect(onSend).not.toHaveBeenCalled();
    expect(within(dlg).getByText(t(K.collabMentionWarnTitle))).toBeInTheDocument();
    expect(dlg).toHaveTextContent(t(K.collabMentionWarnBody, { names: "An" }));
    fireEvent.click(within(dlg).getByRole("button", { name: t(K.collabShareViewThenSend) }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(shareCalls()).toHaveLength(1);
    expect(shareCalls()[0]!.body).toEqual({ principal_type: "user", principal_id: AN, level: "view" });
    expect(box).toHaveValue("");
  });

  it("F3/N2: lists every name through Intl.ListFormat, never 'and N others', and shares sequentially in order", async () => {
    installApi({ candidates: [person(AN, "An"), person(BINH, "Bình"), person(CUONG, "Cường")] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = mount(onSend);
    await pick(box, "", "An");
    await pick(box, `${box.value}`, "Bình");
    await pick(box, `${box.value}`, "Cường");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    const dlg = await dialog();
    expect(dlg).toHaveTextContent(t(K.collabMentionWarnBody, { names: names.format(["An", "Bình", "Cường"]) }));
    fireEvent.click(within(dlg).getByRole("button", { name: t(K.collabShareViewThenSend) }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(shareCalls().map((c) => (c.body as { principal_id: string }).principal_id)).toEqual([AN, BINH, CUONG]);
  });

  it("N4: mixed can_share shares only the shareable people and names the others neutrally", async () => {
    installApi({ candidates: [person(AN, "An"), person(BINH, "Bình")] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = mount(onSend, { canShare: (id) => id === AN });
    await pick(box, "", "An");
    await pick(box, `${box.value}`, "Bình");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    const dlg = await dialog();
    expect(dlg).toHaveTextContent(t(K.collabMentionMixedUnshareable, { unshareable: "Bình" }));
    fireEvent.click(within(dlg).getByRole("button", { name: t(K.collabShareViewThenSend) }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(shareCalls().map((c) => (c.body as { principal_id: string }).principal_id)).toEqual([AN]);
  });

  it("asks someone who manages the document when the caller cannot share, with no share button", async () => {
    installApi({ candidates: [person(AN, "An")] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = mount(onSend, { canShare: false });
    await pick(box, "", "An");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    const dlg = await dialog();
    expect(dlg).toHaveTextContent(t(K.collabMentionAskManager, { names: "An" }));
    expect(within(dlg).queryByRole("button", { name: t(K.collabShareViewThenSend) })).toBeNull();
    fireEvent.click(within(dlg).getByRole("button", { name: t(K.collabSendWithoutNotify) }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(shareCalls()).toHaveLength(0);
  });

  it("cancel closes the dialog and keeps the draft and sends nothing", async () => {
    installApi({ candidates: [person(AN, "An")] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = mount(onSend);
    await pick(box, "", "An");
    const draft = box.value;
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    fireEvent.click(within(await dialog()).getByRole("button", { name: t(K.collabCancel) }));
    await waitFor(() => expect(screen.queryByTestId("composer-mention-warn-dialog")).toBeNull());
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue(draft);
  });

  it("sharing: disables every button (aria-disabled) with a spinner label while a share is in flight", async () => {
    installApi({ candidates: [person(AN, "An")] });
    let release: () => void = () => undefined;
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: string, init?: { method?: string; body?: unknown }) =>
      (init?.method ?? "GET").toUpperCase() === "POST" && path.endsWith("/shares")
        ? new Promise((resolve) => { release = () => resolve(shareAnswer(AN)); })
        : base(path, init),
    );
    const box = mount(() => Promise.resolve("sent"));
    await pick(box, "", "An");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    const dlg = await dialog();
    fireEvent.click(within(dlg).getByRole("button", { name: t(K.collabShareViewThenSend) }));
    const busy = await within(dlg).findByRole("button", { name: t(K.collabSharingView) });
    expect(busy).toHaveAttribute("aria-disabled", "true");
    expect(within(dlg).getByRole("button", { name: t(K.collabCancel) })).toHaveAttribute("aria-disabled", "true");
    expect(within(dlg).getByRole("button", { name: t(K.collabSendWithoutNotify) })).toHaveAttribute("aria-disabled", "true");
    release();
    await waitFor(() => expect(screen.queryByTestId("composer-mention-warn-dialog")).toBeNull());
  });

  it("N3: every share fails -> keeps the dialog and draft, names who failed, offers Retry / send without notifying, never sends", async () => {
    installApi({ candidates: [person(AN, "An"), person(BINH, "Bình")], shareFails: [AN, BINH] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = mount(onSend);
    await pick(box, "", "An");
    await pick(box, `${box.value}`, "Bình");
    const draft = box.value;
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    fireEvent.click(within(await dialog()).getByRole("button", { name: t(K.collabShareViewThenSend) }));
    const alert = await screen.findByTestId("composer-mention-warn-error");
    expect(alert).toHaveTextContent(t(K.collabShareViewFailed, { failedNames: names.format(["An", "Bình"]) }));
    expect(onSend).not.toHaveBeenCalled();
    expect(box).toHaveValue(draft);
    const dlg = await dialog();
    expect(within(dlg).getByRole("button", { name: t(K.collabRetry) })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: t(K.collabSendWithoutNotify) })).toBeInTheDocument();
    expect(within(dlg).getByRole("button", { name: t(K.collabCancel) })).toBeInTheDocument();
  });

  it("N3: partial success -> Send comment (no more shares) and Try again for the failed person only", async () => {
    installApi({ candidates: [person(AN, "An"), person(BINH, "Bình")], shareFails: [BINH] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>("sent"));
    const box = mount(onSend);
    await pick(box, "", "An");
    await pick(box, `${box.value}`, "Bình");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    fireEvent.click(within(await dialog()).getByRole("button", { name: t(K.collabShareViewThenSend) }));
    const alert = await screen.findByTestId("composer-mention-warn-error");
    expect(alert).toHaveTextContent(t(K.collabShareViewPartial, { sharedNames: "An", failedNames: "Bình" }));
    expect(onSend).not.toHaveBeenCalled();
    const dlg = await dialog();
    fireEvent.click(within(dlg).getByRole("button", { name: t(K.collabRetryShareFor, { failedNames: "Bình" }) }));
    await waitFor(() => expect(shareCalls()).toHaveLength(3));
    expect((shareCalls()[2]!.body as { principal_id: string }).principal_id).toBe(BINH);
    fireEvent.click(within(await dialog()).getByRole("button", { name: t(K.collabSendComment) }));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(shareCalls()).toHaveLength(3);
  });

  it("F2: a failed send after sharing says view was granted, keeps the text, and the retry does not share again", async () => {
    installApi({ candidates: [person(AN, "An")] });
    const onSend = vi.fn<(b: string) => Promise<SendOutcome>>().mockResolvedValueOnce("failed").mockResolvedValue("sent");
    const box = mount(onSend);
    await pick(box, "", "An");
    const draft = box.value;
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    fireEvent.click(within(await dialog()).getByRole("button", { name: t(K.collabShareViewThenSend) }));
    const problem = await screen.findByTestId("composer-problem");
    expect(problem).toHaveTextContent(t(K.collabSendFailedAfterShare, { sharedNames: "An" }));
    expect(box).toHaveValue(draft);
    fireEvent.click(screen.getByTestId("composer-send"));
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("composer-mention-warn-dialog")).toBeNull();
    expect(shareCalls()).toHaveLength(1);
  });

  it("F4: a typed mention (never picked) is not warned before sending; the post-send notice reports it", async () => {
    installApi({ candidates: [] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>({ status: "sent", mentionsWithoutAccess: [{ user_id: AN, display_name: "An", can_share: true }] }));
    const box = mount(onSend);
    type(box, `Gửi ${tok(AN, "An")} `);
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("composer-mention-warn-dialog")).toBeNull();
    const notice = await screen.findByTestId("composer-post-send-notice");
    expect(notice).toHaveTextContent(t(K.collabPostSendNoAccess, { names: "An" }));
    expect(notice).toHaveTextContent(t(K.collabPostSendNoRetroNote));
    expect(within(notice).queryByRole("button", { name: t(K.collabSendWithoutNotify) })).toBeNull();
    fireEvent.click(within(notice).getByRole("button", { name: t(K.collabPostSendShareAction) }));
    await waitFor(() => expect(shareCalls()).toHaveLength(1));
    expect(shareCalls()[0]!.body).toEqual({ principal_type: "user", principal_id: AN, level: "view" });
    await waitFor(() => expect(screen.queryByTestId("composer-post-send-notice")).toBeNull());
  });

  it("post-send notice has no share action when nobody in it can be shared with", async () => {
    installApi({ candidates: [] });
    const onSend = vi.fn(() => Promise.resolve<SendOutcome>({ status: "sent", mentionsWithoutAccess: [{ user_id: AN, display_name: "An", can_share: false }] }));
    const box = mount(onSend);
    type(box, "hi");
    fireEvent.keyDown(box, { key: "Enter", ctrlKey: true });
    const notice = await screen.findByTestId("composer-post-send-notice");
    expect(within(notice).queryByRole("button")).toBeNull();
    expect(notice).not.toHaveTextContent(t(K.collabPostSendNoRetroNote));
  });
});

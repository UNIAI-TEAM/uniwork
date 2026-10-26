import type { Editor } from "@tiptap/core";
import { useState } from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { AskAnswerCard } from "./ask-answer-card";
import { useMeetingSuggestions } from "./composer-suggestions";
import { MeetingComposer, type MeetingAsk } from "./meeting-composer";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const answer = {
  conversation_id: "c1",
  message: { id: "a1", role: "assistant", content: "Demo vào thứ Sáu [S1].", notice: "", citations: [], created_at: "2026-10-21T02:00:00Z" },
};

type Init = { method?: string; body?: Record<string, unknown>; signal?: AbortSignal };
let caps: Record<string, unknown> = { enabled: true, ask_uni: true };
const calls = (suffix: string) => requestMock.mock.calls.filter(([p]) => String(p).endsWith(suffix)) as [string, Init][];
const askBody = (i = -1) => calls("/ai/ask").at(i)![1].body!;

/** An ask that waits until the test answers it, or rejects as fetch does when its signal aborts. */
function holdAsk() {
  let answerNow: (value: unknown) => void = () => {};
  const base = requestMock.getMockImplementation()!;
  requestMock.mockImplementation((path: unknown, init?: Init) =>
    String(path).endsWith("/ai/ask")
      ? new Promise((resolve, reject) => {
          answerNow = resolve;
          init?.signal?.addEventListener("abort", () => reject(new DOMException("The operation was aborted.", "AbortError")));
        })
      : base(path, init),
  );
  return (v: unknown) => answerNow(v);
}

beforeEach(() => {
  caps = { enabled: true, ask_uni: true };
  vi.mocked(toast.error).mockClear();
  useAiPanelStore.setState({ open: false, conversationId: null, pendingFocus: null, focusByConversation: {}, conversationByMeeting: {} });
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/ai/capabilities")) return Promise.resolve(caps);
    if (p.endsWith("/ai/ask")) return Promise.resolve(answer);
    if (p.endsWith("/ai/conversations/c1/messages")) {
      return Promise.resolve({ messages: [{ id: "q1", role: "user", content: "Đã chốt gì?", citations: [] }, answer.message] });
    }
    return Promise.resolve({});
  });
});

/** The UNI tab as Task 6 wires it: the answer card in the feed, the composer pinned under it. */
function Room({ notesCount = 0, hasTranscript = false, hasItems }: { notesCount?: number; hasTranscript?: boolean; hasItems?: boolean }) {
  const [ask, setAsk] = useState<MeetingAsk | null>(null);
  const suggestions = useMeetingSuggestions(hasItems ?? false);
  return (
    <>
      {ask ? <AskAnswerCard {...ask} canShare={false} meetingId="m1" workspaceId="w1" /> : null}
      <MeetingComposer
        workspaceId="w1"
        meetingId="m1"
        notesCount={notesCount}
        hasTranscript={hasTranscript}
        suggestions={hasItems === undefined ? [] : suggestions}
        onAsked={setAsk}
      />
    </>
  );
}

const editor = async () => (await screen.findByRole("textbox", { name: "Hỏi riêng UNI về cuộc họp" })) as HTMLElement & { editor: Editor };
async function ask(question: string) {
  const box = await editor();
  act(() => {
    box.editor.commands.insertContent(question);
  });
  fireEvent.keyDown(box, { key: "Enter" });
}
const frame = () => screen.getByTestId("meeting-composer-frame");
const radio = (name: string) => screen.getByRole("radio", { name });

describe("MeetingComposer — asking UNI", () => {
  it("sends the question on Enter, about this meeting, and shows the answer over it", async () => {
    render(wrapWithNav(<Room />));
    await ask("Đã chốt gì?");
    await waitFor(() => expect(calls("/ai/ask")).toHaveLength(1));
    expect(askBody()).toMatchObject({ question: "Đã chốt gì?", mentions: [], locale: "vi", focus: { kind: "meeting", id: "m1" } });
    expect(askBody().signal).toBeUndefined();
    expect(calls("/ai/ask")[0]![1].signal).toBeInstanceOf(AbortSignal);
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
    expect(screen.getByText("Đã chốt gì?")).toBeInTheDocument();
    expect(radio("Hỏi")).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Họp này")).toBeInTheDocument();
  });

  it("while UNI works runs the beam, says what it reads and offers Stop; Stop cancels and gives the question back, without an error", async () => {
    holdAsk();
    render(wrapWithNav(<Room notesCount={3} hasTranscript />));
    await ask("Ai trình bày?");
    const status = await screen.findByText("Đang đọc lời thoại và 3 ghi chú…");
    expect(status).toHaveClass("ai-shimmer");
    expect(status.closest("[role=status]")).not.toBeNull();
    expect(frame()).toHaveClass("ai-edge", "border-beam-ai");
    expect(screen.getByText("Riêng bạn")).toBeInTheDocument();
    // The question stays on screen while UNI is answering.
    expect(screen.getByText("Ai trình bày?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dừng" }));
    expect(calls("/ai/ask")[0]![1].signal!.aborted).toBe(true);
    await waitFor(() => expect(screen.queryByRole("button", { name: "Dừng" })).not.toBeInTheDocument());
    expect(frame()).not.toHaveClass("border-beam-ai");
    expect((await editor()).textContent).toBe("Ai trình bày?");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByText("Đang đọc lời thoại và 3 ghi chú…")).not.toBeInTheDocument();
  });

  it("says it reads the meeting when there are no notes and transcript to name", async () => {
    holdAsk();
    render(wrapWithNav(<Room notesCount={2} />));
    await ask("Ai trình bày?");
    expect(await screen.findByText("Đang đọc cuộc họp…")).toHaveClass("ai-shimmer");
  });

  it("says through one status region that UNI is working, then reads the answer once it lands", async () => {
    const answerNow = holdAsk();
    render(wrapWithNav(<Room />));
    await editor();
    // Mounted before the first question, so the screen reader is already listening to it.
    const region = screen.getByTestId("meeting-ask-live");
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveTextContent("");
    await ask("Đã chốt gì?");
    await waitFor(() => expect(region).toHaveTextContent("Đang đọc cuộc họp…"));
    answerNow(answer);
    await waitFor(() => expect(region).toHaveTextContent("UNI trả lời: Demo vào thứ Sáu."));
    expect(screen.getByTestId("meeting-ask-live")).toBe(region);
  });

  it("shows a real failure and gives the question back", async () => {
    requestMock.mockImplementation((path: unknown) =>
      String(path).endsWith("/ai/ask")
        ? Promise.reject(new ApiError("slow down", "ai_rate_limited", 429))
        : Promise.resolve(String(path).endsWith("/ai/capabilities") ? caps : {}),
    );
    render(wrapWithNav(<Room />));
    await ask("Ai trình bày?");
    expect(await screen.findByRole("alert")).toHaveTextContent("Bạn đang hỏi quá nhanh");
    expect((await editor()).textContent).toBe("Ai trình bày?");
  });

  it("keeps the last answer when it unmounts and mounts again, and a follow-up stays in the conversation", async () => {
    const { unmount } = render(wrapWithNav(<Room />));
    await ask("Đã chốt gì?");
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
    unmount();

    render(wrapWithNav(<Room />));
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
    expect(screen.getByText("Đã chốt gì?")).toBeInTheDocument();
    expect(await screen.findByRole("textbox", { name: "Hỏi riêng UNI về cuộc họp" })).toHaveAttribute("aria-placeholder", "Hỏi tiếp…");

    await ask("Ai làm?");
    await waitFor(() => expect(askBody()).toMatchObject({ question: "Ai làm?", conversation_id: "c1" }));
  });

  it("keeps an answer that lands after the composer unmounted (a tab switch while UNI answers)", async () => {
    const answerNow = holdAsk();
    const { unmount } = render(wrapWithNav(<Room />));
    await ask("Đã chốt gì?");
    await waitFor(() => expect(calls("/ai/ask")).toHaveLength(1));
    unmount();
    answerNow(answer);

    await waitFor(() => expect(useAiPanelStore.getState().conversationByMeeting).toEqual({ m1: "c1" }));
    render(wrapWithNav(<Room />));
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
    // An answer read back from history is not news.
    expect(screen.getByTestId("meeting-ask-live")).toHaveTextContent("");
  });

  it("forgets a conversation the server no longer knows, so the next question starts a new one", async () => {
    useAiPanelStore.setState({ conversationByMeeting: { m1: "gone" }, focusByConversation: { gone: { kind: "meeting", id: "m1" } } });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: Init) => {
      if (String(path).endsWith("/ai/ask") && init?.body?.conversation_id === "gone") {
        return Promise.reject(new ApiError("not found", "not_found", 404));
      }
      if (String(path).endsWith("/ai/conversations/gone/messages")) return Promise.reject(new ApiError("not found", "not_found", 404));
      return base(path, init);
    });
    render(wrapWithNav(<Room />));
    await ask("Đã chốt gì?");
    await waitFor(() => expect(useAiPanelStore.getState().conversationByMeeting).toEqual({}));

    // The question came back to the box; Enter asks it again, now in a new conversation.
    fireEvent.keyDown(await editor(), { key: "Enter" });
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
    expect(askBody().conversation_id).toBeUndefined();
  });

  it("the @ button starts a mention in the question", async () => {
    render(wrapWithNav(<Room />));
    const box = await editor();
    fireEvent.click(screen.getByRole("button", { name: "Nhắc tới việc, người, tài liệu" }));
    await waitFor(() => expect(box.textContent).toBe("@"));
  });

  it("offers suggestions while the box is empty, and a pick asks it at once", async () => {
    render(wrapWithNav(<Room hasItems />));
    await editor();
    fireEvent.click(screen.getByRole("button", { name: "Đã chốt gì?" }));
    await waitFor(() => expect(calls("/ai/ask")).toHaveLength(1));
    expect(askBody()).toMatchObject({ question: "Cuộc họp đã chốt những gì?", focus: { kind: "meeting", id: "m1" } });
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
  });

  it("hides the suggestions once something is typed and in note mode", async () => {
    render(wrapWithNav(<Room hasItems />));
    const box = await editor();
    expect(screen.getByRole("button", { name: "5 phút qua" })).toBeInTheDocument();
    act(() => {
      box.editor.commands.insertContent("Ai");
    });
    expect(screen.queryByRole("button", { name: "5 phút qua" })).not.toBeInTheDocument();
    act(() => {
      box.editor.commands.clearContent(true);
    });
    expect(screen.getByRole("button", { name: "5 phút qua" })).toBeInTheDocument();
    fireEvent.click(radio("Ghi chú"));
    expect(screen.queryByRole("button", { name: "5 phút qua" })).not.toBeInTheDocument();
  });
});

describe("MeetingComposer — notes", () => {
  it("saves a note for everyone in the room and empties the box", async () => {
    render(wrapWithNav(<Room />));
    await editor();
    fireEvent.click(radio("Ghi chú"));
    expect(radio("Ghi chú")).toHaveAttribute("aria-checked", "true");
    expect(frame()).toHaveClass("ai-edge", "ai-edge-note");
    expect(screen.getByText("Cả phòng")).toBeInTheDocument();
    expect(screen.queryByText("Họp này")).not.toBeInTheDocument();
    const box = screen.getByRole("textbox", { name: "Ghi chú cho cả phòng" });
    fireEvent.change(box, { target: { value: "Mời đại diện cửa hàng Q7" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));

    await waitFor(() => expect(calls("/meetings/m1/notes")).toHaveLength(1));
    expect(calls("/meetings/m1/notes")[0]![1]).toMatchObject({ method: "POST", body: { body: "Mời đại diện cửa hàng Q7" } });
    await waitFor(() => expect(box).toHaveValue(""));
  });

  it("the mode radios move with the arrow keys", async () => {
    render(wrapWithNav(<Room />));
    await editor();
    expect(radio("Hỏi")).toHaveAttribute("tabindex", "0");
    expect(radio("Ghi chú")).toHaveAttribute("tabindex", "-1");
    fireEvent.keyDown(radio("Hỏi"), { key: "ArrowRight" });
    expect(radio("Ghi chú")).toHaveAttribute("aria-checked", "true");
    expect(radio("Ghi chú")).toHaveFocus();
    fireEvent.keyDown(radio("Ghi chú"), { key: "ArrowLeft" });
    expect(radio("Hỏi")).toHaveAttribute("aria-checked", "true");
  });

  it("Enter saves, Shift+Enter starts a new line", async () => {
    render(wrapWithNav(<Room />));
    await editor();
    fireEvent.click(radio("Ghi chú"));
    const box = screen.getByRole("textbox", { name: "Ghi chú cho cả phòng" });
    fireEvent.change(box, { target: { value: "Một" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(calls("/meetings/m1/notes")).toHaveLength(0);
    fireEvent.keyDown(box, { key: "Enter" });
    await waitFor(() => expect(calls("/meetings/m1/notes")).toHaveLength(1));
  });

  it("keeps the note and says so when it cannot be saved", async () => {
    requestMock.mockImplementation((path: unknown) =>
      String(path).endsWith("/notes") ? Promise.reject(new Error("boom")) : Promise.resolve(String(path).endsWith("/ai/capabilities") ? caps : {}),
    );
    render(wrapWithNav(<Room />));
    await editor();
    fireEvent.click(radio("Ghi chú"));
    const box = screen.getByRole("textbox", { name: "Ghi chú cho cả phòng" });
    fireEvent.change(box, { target: { value: "Một" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Chưa thêm được ghi chú. Thử lại."));
    expect(box).toHaveValue("Một");
  });
});

describe("MeetingComposer — Ask UNI blocked (Review Focus 1)", () => {
  it("out of credit: starts in note mode with the reason, Ask locked, and notes still save", async () => {
    caps = { enabled: true, ask_uni: true, quota: { used_tokens: 10, limit_tokens: 10 } };
    render(wrapWithNav(<Room />));
    expect(await screen.findByText("Hết lượt Hỏi UNI tháng này")).toBeInTheDocument();
    expect(radio("Ghi chú")).toHaveAttribute("aria-checked", "true");
    expect(radio("Hỏi")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(radio("Hỏi"));
    expect(radio("Ghi chú")).toHaveAttribute("aria-checked", "true");
    fireEvent.keyDown(radio("Ghi chú"), { key: "ArrowLeft" });
    expect(radio("Ghi chú")).toHaveAttribute("aria-checked", "true");

    fireEvent.click(screen.getByRole("button", { name: "Vì sao và cách xử lý" }));
    expect(await screen.findByText(/Tổ chức đã dùng hết hạn mức token AI của tháng/)).toBeInTheDocument();

    fireEvent.change(screen.getByRole("textbox", { name: "Ghi chú cho cả phòng" }), { target: { value: "Một" } });
    fireEvent.click(screen.getByRole("button", { name: "Lưu ghi chú" }));
    await waitFor(() => expect(calls("/meetings/m1/notes")).toHaveLength(1));
  });

  it("an ask refused for quota switches to note mode instead of failing", async () => {
    requestMock.mockImplementation((path: unknown) =>
      String(path).endsWith("/ai/ask")
        ? Promise.reject(new ApiError("quota", "ai_quota_exceeded", 429))
        : Promise.resolve(String(path).endsWith("/ai/capabilities") ? caps : {}),
    );
    render(wrapWithNav(<Room />));
    await ask("Ai trình bày?");
    expect(await screen.findByText("Hết lượt Hỏi UNI tháng này")).toBeInTheDocument();
    expect(radio("Ghi chú")).toHaveAttribute("aria-checked", "true");
    expect(radio("Hỏi")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("Ask UNI off for the workspace: note mode with the reason", async () => {
    caps = { enabled: false };
    render(wrapWithNav(<Room />));
    expect(await screen.findByText("Hỏi UNI chưa bật")).toBeInTheDocument();
    expect(radio("Ghi chú")).toHaveAttribute("aria-checked", "true");
    expect(radio("Hỏi")).toHaveAttribute("aria-disabled", "true");
    expect(screen.queryByRole("textbox", { name: "Hỏi riêng UNI về cuộc họp" })).not.toBeInTheDocument();
  });
});

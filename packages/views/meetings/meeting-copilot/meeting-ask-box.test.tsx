import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import { ApiError } from "@uniwork/core/api/http";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { MeetingAskBox } from "./meeting-ask-box";

const answer = {
  conversation_id: "c1",
  message: { id: "a1", role: "assistant", content: "Demo vào thứ Sáu [S1].", notice: "", citations: [], created_at: "2026-10-21T02:00:00Z" },
};

beforeEach(() => {
  useAiPanelStore.setState({ open: false, conversationId: null, pendingFocus: null, focusByConversation: {}, conversationByMeeting: {} });
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) => {
    const p = String(path);
    if (p.endsWith("/ai/capabilities")) return Promise.resolve({ enabled: true, ask_uni: true });
    if (p.endsWith("/ai/ask")) return Promise.resolve(answer);
    if (p.endsWith("/ai/conversations/c1/messages")) {
      return Promise.resolve({ messages: [{ id: "q1", role: "user", content: "Đã chốt gì?", citations: [] }, answer.message] });
    }
    return Promise.resolve({});
  });
});

describe("MeetingAskBox", () => {
  it("keeps the last answer when it unmounts and mounts again, and continues it in ⌘J with the meeting focus", async () => {
    const ui = () => wrapWithNav(<MeetingAskBox workspaceId="w1" meetingId="m1" canShare={false} />);
    const { unmount } = render(ui());
    fireEvent.change(await screen.findByRole("textbox", { name: "Câu hỏi cho UNI về cuộc họp này" }), {
      target: { value: "Đã chốt gì?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hỏi" }));
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
    unmount();

    render(ui());
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
    expect(screen.getByText("Đã chốt gì?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Hỏi tiếp trong UNI" }));
    expect(useAiPanelStore.getState()).toMatchObject({
      open: true,
      conversationId: "c1",
      focusByConversation: { c1: { kind: "meeting", id: "m1" } },
    });

    // A follow-up from the box stays in the same conversation.
    fireEvent.change(screen.getByRole("textbox", { name: "Câu hỏi cho UNI về cuộc họp này" }), { target: { value: "Ai làm?" } });
    fireEvent.click(screen.getByRole("button", { name: "Hỏi" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith(
        "/api/v1/workspaces/w1/ai/ask",
        expect.objectContaining({ body: expect.objectContaining({ question: "Ai làm?", conversation_id: "c1" }) }),
      ),
    );
  });

  it("keeps an answer that lands after the box unmounted (a tab switch while UNI answers)", async () => {
    let answerNow: (value: unknown) => void = () => {};
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: unknown) =>
      String(path).endsWith("/ai/ask") ? new Promise((resolve) => (answerNow = resolve)) : base(path, init),
    );
    const ui = () => wrapWithNav(<MeetingAskBox workspaceId="w1" meetingId="m1" canShare={false} />);
    const { unmount } = render(ui());
    fireEvent.change(await screen.findByRole("textbox", { name: "Câu hỏi cho UNI về cuộc họp này" }), {
      target: { value: "Đã chốt gì?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Hỏi" }));
    await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/w1/ai/ask", expect.anything()));
    unmount();
    answerNow(answer);

    await waitFor(() => expect(useAiPanelStore.getState().conversationByMeeting).toEqual({ m1: "c1" }));
    render(ui());
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
  });

  it("forgets a conversation the server no longer knows, so the next question starts a new one", async () => {
    useAiPanelStore.setState({ conversationByMeeting: { m1: "gone" }, focusByConversation: { gone: { kind: "meeting", id: "m1" } } });
    const base = requestMock.getMockImplementation()!;
    requestMock.mockImplementation((path: unknown, init?: { body?: { conversation_id?: string } }) => {
      if (String(path).endsWith("/ai/ask") && init?.body?.conversation_id === "gone") {
        return Promise.reject(new ApiError("not found", "not_found", 404));
      }
      if (String(path).endsWith("/ai/conversations/gone/messages")) return Promise.reject(new ApiError("not found", "not_found", 404));
      return base(path, init);
    });
    render(wrapWithNav(<MeetingAskBox workspaceId="w1" meetingId="m1" canShare={false} />));
    const box = await screen.findByRole("textbox", { name: "Câu hỏi cho UNI về cuộc họp này" });
    fireEvent.change(box, { target: { value: "Đã chốt gì?" } });
    fireEvent.click(screen.getByRole("button", { name: "Hỏi" }));
    await waitFor(() => expect(useAiPanelStore.getState().conversationByMeeting).toEqual({}));

    fireEvent.click(screen.getByRole("button", { name: "Hỏi" }));
    expect(await screen.findByText("Demo vào thứ Sáu [S1].")).toBeInTheDocument();
    const asks = requestMock.mock.calls.filter(([p]) => String(p).endsWith("/ai/ask"));
    expect((asks.at(-1)?.[1] as { body: { conversation_id?: string } }).body.conversation_id).toBeUndefined();
  });
});

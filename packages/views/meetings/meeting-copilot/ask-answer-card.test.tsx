import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useAiPanelStore } from "@uniwork/core/ai";
import type { AiMessage } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../../test/api-mock";
import { AskAnswerCard } from "./ask-answer-card";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

const message = (over: Partial<AiMessage> = {}) =>
  ({
    id: "a1",
    role: "assistant",
    content: "Lúc 09:05 An chốt demo thứ Sáu [S1].",
    notice: "",
    citations: [{ source_id: "S1", kind: "transcript", title: "Giao ban", quote: "", href: "/o/w/meetings/m1#transcript" }],
    created_at: "2026-10-21T02:00:00Z",
    ...over,
  }) as AiMessage;

type Props = Partial<Parameters<typeof AskAnswerCard>[0]>;
const card = (p: Props = {}) =>
  wrapWithNav(
    <AskAnswerCard
      question="Đã chốt gì về demo?"
      answer={message()}
      conversationId="c1"
      canShare
      meetingId="m1"
      workspaceId="w1"
      {...p}
    />,
  );

const chatPosts = () =>
  requestMock.mock.calls.filter(([p, init]) => String(p).endsWith("/meetings/m1/chat") && (init as { method?: string } | undefined)?.method === "POST");

beforeEach(() => {
  vi.mocked(toast.success).mockClear();
  useAiPanelStore.setState({ open: false, conversationId: null, pendingFocus: null, focusByConversation: {}, conversationByMeeting: {} });
  requestMock.mockReset();
  requestMock.mockImplementation((path: unknown) =>
    Promise.resolve(String(path).endsWith("/ai/capabilities") ? { enabled: true, ask_uni: true } : {}),
  );
});

describe("AskAnswerCard", () => {
  it("shows the question as the asker's bubble and the answer as UNI's, private to the asker", () => {
    render(card());
    expect(screen.getByText("Đã chốt gì về demo?").closest(".bg-surface-hover")).not.toBeNull();
    const answer = screen.getByRole("article", { name: "Hỏi UNI" });
    // The [S1] marker gives way to the source pill.
    expect(within(answer).getByText("Lúc 09:05 An chốt demo thứ Sáu.")).toBeInTheDocument();
    expect(within(answer).getByText("Riêng bạn")).toHaveAttribute("title", "Chỉ bạn thấy câu trả lời này.");
  });

  it("draws the answer's markdown: bold and a list", () => {
    render(card({ answer: message({ content: "Giữ **120 triệu**.\n\n- Lịch đăng bài dời\n- Tiền dồn cho tuần ra mắt" }) }));
    const article = screen.getByRole("article", { name: "Hỏi UNI" });
    expect(within(article).getByText("120 triệu").tagName).toBe("STRONG");
    expect(within(article).getByText("Lịch đăng bài dời").tagName).toBe("LI");
    expect(within(article).getByText("Tiền dồn cho tuần ra mắt").tagName).toBe("LI");
  });

  // The question is the composer's markdown: entities and escapes read as typed, marks as formatting.
  it("shows the question as the composer wrote it, not its markdown source", () => {
    render(card({ question: "Ai làm **R&amp;D** cho user\\_id?" }));
    expect(screen.getByText("R&D").tagName).toBe("STRONG");
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Ai làm R&D cho user_id?")).toBeInTheDocument();
  });

  it("while UNI works shows the question only", () => {
    render(card({ answer: null }));
    expect(screen.getByText("Đã chốt gì về demo?")).toBeInTheDocument();
    expect(screen.queryByRole("article")).not.toBeInTheDocument();
  });

  it("shares the answer as the asker's chat message, without the source markers, and says so in place", async () => {
    render(card());
    fireEvent.click(screen.getByRole("button", { name: "Gửi vào Chat" }));
    await waitFor(() => expect(chatPosts()).toHaveLength(1));
    expect((chatPosts()[0]![1] as { body: unknown }).body).toEqual({ message: "Lúc 09:05 An chốt demo thứ Sáu." });
    // One success signal, in place: no toast on top of it.
    const box = screen.getByTestId("meeting-ask-uni");
    expect(await within(box).findByRole("status")).toHaveTextContent("Đã chia sẻ vào chat cuộc họp");
    expect(within(box).getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Gửi vào Chat" })).not.toBeInTheDocument();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it("offers no sharing to someone who is not in the room", () => {
    render(card({ canShare: false }));
    expect(screen.queryByRole("button", { name: "Gửi vào Chat" })).not.toBeInTheDocument();
  });

  it("continues the conversation in ⌘J with the meeting focus", () => {
    render(card());
    fireEvent.click(screen.getByRole("button", { name: "Tiếp" }));
    expect(useAiPanelStore.getState()).toMatchObject({
      open: true,
      conversationId: "c1",
      focusByConversation: { c1: { kind: "meeting", id: "m1" } },
    });
  });

  it("keeps its status region quiet until the answer is shared (the composer reads the answer itself)", () => {
    render(card());
    const region = within(screen.getByTestId("meeting-ask-uni")).getByRole("status");
    expect(region).toHaveTextContent("");
  });

  it("lists each source once as a pill, however often the answer cites it (UNI-1995 #23)", () => {
    const cite = (source_id: string, title: string, quote: string) => ({ source_id, kind: "meeting", title, quote, href: `/o/w/meetings/${source_id}` });
    render(
      card({
        answer: message({
          content: "Ba việc [S2][S2][S1][S2].",
          citations: [cite("S2", "Giao ban", "a"), cite("S2", "Giao ban", "b"), cite("S1", "Họp quý", "c"), cite("S2", "Giao ban", "d")],
        }),
      }),
    );
    const list = screen.getByRole("list", { name: "Nguồn" });
    // The markers are stripped from the text, so a pill's "[Sn]" would point at nothing.
    expect(Array.from(list.querySelectorAll("a")).map((a) => a.textContent)).toEqual(["Giao ban", "Họp quý"]);
  });

  it("gives two sources that open the same place one pill", () => {
    const href = "/o/w/meetings/m1#transcript";
    const cite = (source_id: string, quote: string) => ({ source_id, kind: "transcript", title: "Giao ban", quote, href });
    render(card({ answer: message({ content: "Hai câu [S1][S2].", citations: [cite("S1", "a"), cite("S2", "b")] }) }));
    const links = within(screen.getByRole("list", { name: "Nguồn" })).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).not.toHaveTextContent("[S");
  });

  it("says why an answer has no text", () => {
    render(card({ answer: message({ content: "", notice: "no_sources", citations: [] }) }));
    expect(within(screen.getByRole("article")).getByText("Chưa có dữ liệu nào bạn được xem khớp với câu hỏi này.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gửi vào Chat" })).not.toBeInTheDocument();
  });

  it("renders nothing before a question", () => {
    render(card({ question: "", answer: null }));
    expect(screen.queryByTestId("meeting-ask-uni")).not.toBeInTheDocument();
  });
});

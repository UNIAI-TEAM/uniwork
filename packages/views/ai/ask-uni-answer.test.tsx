import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AiMessage } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniMessageTurn } from "./ask-uni-answer";

initI18n();

const cite = { source_id: "S1", kind: "task", title: "Thiết kế trang chủ", quote: "Hạn thứ sáu, chưa có người nhận", href: "/acme/team/tasks/T1" };

function msg(over: Partial<AiMessage> = {}): AiMessage {
  return { id: "m1", role: "assistant", content: "", notice: "", citations: [], created_at: "", ...over };
}

function mount(message: AiMessage, props: Partial<Parameters<typeof AskUniMessageTurn>[0]> = {}) {
  return render(wrapWithNav(<AskUniMessageTurn message={message} conversationId="c1" {...props} />));
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
});

describe("AskUniMessageTurn", () => {
  it("renders markdown without a bubble", () => {
    const { container } = mount(msg({ content: "**Đậm** và danh sách\n\n- một\n- hai" }));
    expect(screen.getByText("Đậm").tagName).toBe("STRONG");
    expect(screen.getByText("một").tagName).toBe("LI");
    expect(screen.getByText("hai").tagName).toBe("LI");
    expect(container.querySelector(".border-border.bg-surface")).toBeNull();
  });

  it("citation marker shows title and quote on click and links to the source", async () => {
    mount(msg({ content: "Việc này quá hạn [S1].", citations: [cite] }));
    const marker = screen.getByRole("button", { name: "Nguồn 1" });
    fireEvent.click(marker);
    expect(await screen.findByText("Hạn thứ sáu, chưa có người nhận")).toBeInTheDocument();
    const open = screen.getByRole("link", { name: "Mở" });
    expect(open).toHaveAttribute("href", cite.href);
  });

  it("renders unknown source markers as text", () => {
    mount(msg({ content: "Không rõ [S9].", citations: [cite] }));
    expect(screen.queryByRole("button", { name: "Nguồn 9" })).toBeNull();
    expect(screen.getByText(/Không rõ \[S9\]\./)).toBeInTheDocument();
  });

  it("blocks external links and images", () => {
    mount(msg({ content: "[ngoài](https://evil.test/x) và ![ảnh chèn](https://evil.test/i.png)" }));
    expect(screen.queryByRole("link", { name: "ngoài" })).toBeNull();
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getByText(/ngoài/)).toBeInTheDocument();
  });

  it("allows a cited href and an in-app path as a link", () => {
    mount(msg({ content: "[xem](/acme/team/tasks/T1) và [ngoài](//evil.test)", citations: [cite] }));
    expect(screen.getByRole("link", { name: "xem" })).toHaveAttribute("href", "/acme/team/tasks/T1");
    expect(screen.queryByRole("link", { name: "ngoài" })).toBeNull();
  });

  it("keeps the row of source chips", () => {
    mount(msg({ content: "ok", citations: [cite] }));
    expect(within(screen.getByRole("list", { name: "Nguồn" })).getByRole("link", { name: /Thiết kế trang chủ/ })).toBeInTheDocument();
  });

  it("steps line sums counts and collapses", () => {
    mount(msg({ content: "xong" }), { counts: { task: 24, meeting: 3, members: 1 } });
    const trigger = screen.getByRole("button", { name: /Đã xem 24 task, 3 cuộc họp/ });
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
  });

  it.each([
    ["stopped", "Đã dừng"],
    ["interrupted", "bị gián đoạn"],
  ])("%s keeps the partial content and adds a notice line", (notice, text) => {
    mount(msg({ content: "Một phần câu trả lời", notice }));
    expect(screen.getByText("Một phần câu trả lời")).toBeInTheDocument();
    expect(screen.getByText(new RegExp(text))).toBeInTheDocument();
  });

  it.each([
    ["agent_failed", /gặp sự cố/],
    ["refused", /từ chối|không thể trả lời/],
    ["no_sources", /Chưa có dữ liệu/],
    ["empty_answer", /không có nội dung/],
    ["whatever_new", /chưa trả lời được/],
  ])("empty answer with notice %s shows its text", (notice, text) => {
    mount(msg({ content: "", notice }));
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it("copy writes the answer", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount(msg({ content: "Nội dung chép" }));
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    expect(writeText).toHaveBeenCalledWith("Nội dung chép");
    expect(await screen.findByRole("button", { name: "Đã sao chép" })).toBeInTheDocument();
  });

  it("regenerate shows only when asked for and calls back", () => {
    const onRegenerate = vi.fn();
    const { unmount } = mount(msg({ content: "a" }));
    expect(screen.queryByRole("button", { name: "Trả lời lại" })).toBeNull();
    unmount();
    mount(msg({ content: "a" }), { onRegenerate });
    fireEvent.click(screen.getByRole("button", { name: "Trả lời lại" }));
    expect(onRegenerate).toHaveBeenCalled();
  });

  it("disables regenerate while another turn streams", () => {
    mount(msg({ content: "a" }), { onRegenerate: vi.fn(), regenerateDisabled: true });
    expect(screen.getByRole("button", { name: "Trả lời lại" })).toHaveAttribute("aria-disabled", "true");
  });

  it("thumbs up sends, and a second click clears", async () => {
    mount(msg({ content: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "Hữu ích" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/conversations/c1/messages/m1/feedback", { method: "PUT", body: { rating: "up" } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Hữu ích" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/conversations/c1/messages/m1/feedback", { method: "DELETE" }),
    );
  });

  it("thumbs down sends a reason", async () => {
    mount(msg({ content: "a" }));
    fireEvent.click(screen.getByRole("button", { name: "Chưa đúng" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Sai thông tin" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Sai số liệu" } });
    fireEvent.click(screen.getByRole("button", { name: "Gửi phản hồi" }));
    await waitFor(() =>
      expect(requestMock).toHaveBeenCalledWith("/api/v1/ai/conversations/c1/messages/m1/feedback", {
        method: "PUT",
        body: { rating: "down", reason: "wrong_facts", note: "Sai số liệu" },
      }),
    );
  });

  it("hides the action bar for users, echoes, live turns and streaming", () => {
    const { unmount } = mount(msg({ role: "user", content: "hỏi" }));
    expect(screen.queryByRole("button", { name: "Sao chép" })).toBeNull();
    unmount();
    const second = mount(msg({ id: "pending-m1", content: "x" }));
    expect(screen.queryByRole("button", { name: "Sao chép" })).toBeNull();
    second.unmount();
    mount(msg({ content: "x" }), { streaming: true });
    expect(screen.queryByRole("button", { name: "Sao chép" })).toBeNull();
  });
});

import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import type { AiMessage } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniMessageTurn } from "./ask-uni-answer";
import { isInAppHref } from "./ask-uni-links";

initI18n();

const cite = { source_id: "S1", kind: "task", title: "Thiết kế trang chủ", quote: "Hạn thứ sáu, chưa có người nhận", href: "/acme/team/tasks/T1" };

function msg(over: Partial<AiMessage> = {}): AiMessage {
  return { id: "m1", role: "assistant", content: "", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], created_at: "", ...over };
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

  it("renders a known source marker as an entity chip linking to the object", () => {
    const { container } = mount(msg({ content: "Việc này quá hạn [S1].", citations: [cite] }));
    expect(screen.getByRole("link", { name: "Task: Thiết kế trang chủ" })).toHaveAttribute("href", cite.href);
    expect(container.querySelector("sup")).toBeNull();
  });

  it("renders a chip inside a link as text, leaving one anchor", () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mount(msg({ content: "[xem [S1]](/acme/team/tasks/T1)", citations: [cite] }));
    expect(document.querySelectorAll("a")).toHaveLength(1);
    expect(within(screen.getByRole("link")).getByText("Thiết kế trang chủ")).toBeInTheDocument();
    expect(err.mock.calls.some((c) => String(c[0]).includes("validateDOMNesting"))).toBe(false);
    err.mockRestore();
  });

  it("shows a name the answer wrote next to its marker once, beside the chip", () => {
    const page = { ...cite, source_id: "S4" };
    const site = { ...cite, kind: "project", title: "Website mới", href: "/acme/team/projects/P1" };
    const { unmount } = mount(msg({ content: "- [S4] Thiết kế trang chủ.", citations: [page] }));
    expect(screen.getByRole("link", { name: "Task: Thiết kế trang chủ" }).closest("li")).toHaveTextContent(/^Thiết kế trang chủ\.$/);
    unmount();
    const bold = mount(msg({ content: "**Website mới** [S1] đang", citations: [site] }));
    expect(screen.getByRole("link", { name: "Dự án: Website mới" }).closest("p")).toHaveTextContent(/^Website mới đang$/);
    bold.unmount();
    mount(msg({ content: "[S1] Thiết kế mới", citations: [cite] }));
    expect(screen.getByRole("link", { name: "Task: Thiết kế trang chủ" }).closest("p")).toHaveTextContent(/^Thiết kế trang chủ Thiết kế mới$/);
  });

  it("drops an unknown source marker", () => {
    mount(msg({ content: "Không rõ [S9].", citations: [cite] }));
    expect(screen.queryByText(/S9/)).toBeNull();
    expect(screen.queryByRole("link", { name: /Task:/ })).toBeNull();
    expect(screen.getByText(/Không rõ/)).toBeInTheDocument();
  });

  it("resolves a marker through the conversation's source map, not only this message", () => {
    const earlier = { ...cite, source_id: "S2", title: "Ra mắt Q4", kind: "project", href: "/acme/team/projects/P1" };
    mount(msg({ content: "4 bước [S2]:" }), { sources: new Map([["S2", earlier]]) });
    expect(screen.getByRole("link", { name: "Dự án: Ra mắt Q4" })).toBeInTheDocument();
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

  it.each([
    ["backslash", "[x](/\\evil.com)"],
    ["entity tab", "[x](/&#9;/evil.com)"],
    ["protocol relative", "[x](//evil.com)"],
    ["absolute", "[x](https://evil.com)"],
  ])("never links an escaping href (%s)", (_n, md) => {
    mount(msg({ content: md }));
    // The markdown layer may percent-encode the href; whatever is rendered must still resolve inside the app.
    const a = screen.queryByRole("link", { name: "x" });
    if (a) expect(new URL(a.getAttribute("href") ?? "", "https://app.invalid").origin).toBe("https://app.invalid");
  });

  it.each(["/\\evil.com", "/\t/evil.com", "//evil.com", "https://evil.com", "/a b", "/a\u0000b", ""])(
    "isInAppHref rejects %j",
    (href) => expect(isInAppHref(href)).toBe(false),
  );
  it("isInAppHref accepts an in-app path", () => expect(isInAppHref("/o/w/tasks/1?x=1#y")).toBe(true));

  it("shows a cited name as plain text when its href leaves the app", () => {
    const bad = { ...cite, href: "//evil.com" };
    mount(msg({ content: "Xem [x](//evil.com) [S1]", citations: [bad] }));
    expect(screen.queryByRole("link", { name: "x" })).toBeNull();
    expect(screen.queryByRole("link", { name: /Thiết kế trang chủ/ })).toBeNull();
    expect(screen.getByText("Thiết kế trang chủ")).toBeInTheDocument();
  });

  it("links an in-app path", () => {
    mount(msg({ content: "[x](/o/w/tasks/1)" }));
    expect(screen.getByRole("link", { name: "x" })).toHaveAttribute("href", "/o/w/tasks/1");
  });

  it("collapses the sources into a count that expands to one row each", () => {
    const second = { ...cite, source_id: "S2", title: "Họp tuần", kind: "meeting", href: "/acme/team/meetings/M1" };
    mount(msg({ content: "ok", citations: [cite, second] }));
    expect(screen.queryByRole("list", { name: "Nguồn" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Nguồn (2)" }));
    expect(within(screen.getByRole("list", { name: "Nguồn" })).getAllByRole("listitem")).toHaveLength(2);
  });

  it("shows the message's own stored steps as a collapsed line", () => {
    mount(msg({ content: "xong", steps: [{ tool: "search", label: "a", counts: {} }, { tool: "get_task", label: "B", counts: {} }] }));
    expect(screen.getByRole("button", { name: "Xong sau 2 bước" })).toHaveAttribute("aria-expanded", "false");
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

  it("copy puts the object's name where a marker was and drops unknown ones", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount(msg({ content: "Đóng băng 5 ngày [S1]. QA kiểm thử [S2][S3].", citations: [cite] }));
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    expect(writeText).toHaveBeenCalledWith("Đóng băng 5 ngày Thiết kế trang chủ. QA kiểm thử.");
  });

  it("copy without a clipboard does not throw", async () => {
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    mount(msg({ content: "x" }));
    fireEvent.click(screen.getByRole("button", { name: "Sao chép" }));
    await Promise.resolve();
    expect(screen.getByRole("button", { name: "Sao chép" })).toBeInTheDocument();
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

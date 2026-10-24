import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { toast } from "sonner";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { downloadAskAttachment } from "@uniwork/core/api/endpoints/ai-attachments";
import { ApiError } from "@uniwork/core/api/http";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { AiProposalSchema, type AiFileNote, type AiMessage } from "@uniwork/core/types";
import { requestMock, wrapWithNav } from "../test/api-mock";
import { AskUniMessageTurn } from "./ask-uni-answer";
import { isInAppHref } from "./ask-uni-links";

vi.mock("sonner", async (orig) => {
  const mod = await orig<typeof import("sonner")>();
  return { ...mod, toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) };
});

vi.mock("@uniwork/core/api/endpoints/ai-attachments", async (orig) => ({
  ...(await orig<typeof import("@uniwork/core/api/endpoints/ai-attachments")>()),
  downloadAskAttachment: vi.fn(),
}));

initI18n();

const cite = { source_id: "S1", kind: "task", title: "Thiết kế trang chủ", quote: "Hạn thứ sáu, chưa có người nhận", href: "/acme/team/tasks/T1" };

function msg(over: Partial<AiMessage> = {}): AiMessage {
  return { id: "m1", role: "assistant", content: "", notice: "", citations: [], steps: [], followups: [], focus: null, mentions: [], model: "", attachments: [], file_notes: [], proposals: [], created_at: "", ...over };
}

function mount(message: AiMessage, props: Partial<Parameters<typeof AskUniMessageTurn>[0]> = {}) {
  return render(wrapWithNav(<AskUniMessageTurn message={message} conversationId="c1" {...props} />));
}

beforeEach(() => {
  requestMock.mockReset();
  requestMock.mockResolvedValue({});
  vi.mocked(toast.error).mockClear();
  vi.mocked(downloadAskAttachment).mockReset();
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

  it("draws a question's markdown, with in-app links only", () => {
    mount(msg({ role: "user", content: "**Đậm** và `a_b`\n- [ngoài](https://x.test) [trong](/o/w/tasks/T1)" }));
    expect(screen.getByText("Đậm").tagName).toBe("STRONG");
    expect(screen.getByText("a_b").closest("code")).not.toBeNull();
    expect(screen.getByText("ngoài").closest("a")).toBeNull();
    expect(screen.getByRole("link", { name: "trong" })).toHaveAttribute("href", "/o/w/tasks/T1");
  });

  it("names the model that answered, UNI for Auto", () => {
    const { unmount } = mount(msg({ content: "a", model: "opus" }));
    expect(screen.getByText(/Opus 5\.5/)).toBeInTheDocument();
    expect(screen.queryByText(/^UNI/)).toBeNull();
    unmount();
    mount(msg({ content: "a" }));
    expect(screen.getByText(/^UNI/)).toBeInTheDocument();
  });

  describe("the proposal card", () => {
    const proposal = AiProposalSchema.parse({
      id: "p1", message_id: "m1", position: 1, tool: "update_task", status: "pending", mode: "ask",
      preview: { target: { kind: "task", id: "T1", title: "Viết spec" }, fields: [{ field: "title", type: "text", from: "a", to: "b" }] },
    });
    const serveActions = (enabled: boolean, ceiling = "plan") =>
      requestMock.mockImplementation((path: string) =>
        Promise.resolve(path === "/api/v1/workspaces/ws1/ai/capabilities" ? { enabled: true, ask_uni: true, actions: { enabled, ceiling, mode: "ask" } } : {}),
      );
    const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

    it("offers the buttons while actions are on", async () => {
      serveActions(true);
      mount(msg({ content: "Xong.", proposals: [proposal] }), { wsId: "ws1" });
      expect(await screen.findByRole("button", { name: "Áp dụng" })).toBeInTheDocument();
    });

    it("keeps the rows as history, with no button, once actions are off", async () => {
      serveActions(false);
      mount(msg({ content: "Xong.", proposals: [proposal] }), { wsId: "ws1" });
      await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/ai/capabilities"));
      await settle();
      expect(screen.getByText("Viết spec")).toBeInTheDocument();
      for (const name of ["Áp dụng", "Sửa", "Bỏ qua"]) expect(screen.queryByRole("button", { name })).toBeNull();
    });

    it("keeps the rows as history under an off ceiling too, where the server refuses every decision", async () => {
      serveActions(true, "off");
      mount(msg({ content: "Xong.", proposals: [proposal] }), { wsId: "ws1" });
      await waitFor(() => expect(requestMock).toHaveBeenCalledWith("/api/v1/workspaces/ws1/ai/capabilities"));
      await settle();
      expect(screen.getByText("Viết spec")).toBeInTheDocument();
      for (const name of ["Áp dụng", "Sửa", "Bỏ qua"]) expect(screen.queryByRole("button", { name })).toBeNull();
    });
  });

  describe("files the question carried", () => {
    const pdf = { id: "att1", name: "bao-cao.pdf", mime: "application/pdf", size: 2048, kind: "pdf" };
    const png = { id: "att2", name: "anh.png", mime: "image/png", size: 4096, kind: "image" };

    it("shows them under the question and saves one under its own name on click", async () => {
      const pdfBlob = new Blob(["x"], { type: "application/pdf" });
      vi.mocked(downloadAskAttachment).mockImplementation((_ws, id) =>
        Promise.resolve(id === "att1" ? pdfBlob : new Blob(["p"], { type: "image/png" })),
      );
      const anchors: HTMLAnchorElement[] = [];
      const realCreate = document.createElement.bind(document);
      const createSpy = vi.spyOn(document, "createElement").mockImplementation(((tag: string) => {
        const el = realCreate(tag);
        if (tag === "a") {
          (el as HTMLAnchorElement).click = vi.fn();
          anchors.push(el as HTMLAnchorElement);
        }
        return el;
      }) as typeof document.createElement);
      URL.createObjectURL = vi.fn(() => "blob:x");
      URL.revokeObjectURL = vi.fn();
      mount(msg({ id: "u1", role: "user", content: "Tóm tắt giúp", attachments: [pdf, png] }), { wsId: "ws1" });
      expect(screen.getByText("anh.png")).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: "Tải bao-cao.pdf" }));
      try {
        await waitFor(() => expect(anchors.at(-1)?.download).toBe("bao-cao.pdf"));
        expect(downloadAskAttachment).toHaveBeenCalledWith("ws1", "att1");
        expect(vi.mocked(URL.createObjectURL).mock.calls.filter(([b]) => b === pdfBlob)).toHaveLength(1);
        expect(toast.error).not.toHaveBeenCalled();
      } finally {
        createSpy.mockRestore();
      }
    });

    it("loads a stored picture once, however many bubbles draw it, and shows it in its chip", async () => {
      const picture = new Blob(["p"], { type: "image/png" });
      vi.mocked(downloadAskAttachment).mockResolvedValue(picture);
      URL.createObjectURL = vi.fn(() => "blob:anh");
      URL.revokeObjectURL = vi.fn();
      render(
        wrapWithNav(
          <>
            <AskUniMessageTurn message={msg({ id: "u1", role: "user", content: "Q", attachments: [pdf, png] })} conversationId="c1" wsId="ws1" />
            <AskUniMessageTurn message={msg({ id: "u2", role: "user", content: "Q2", attachments: [png] })} conversationId="c1" wsId="ws1" />
          </>,
        ),
      );
      await waitFor(() => expect(document.querySelectorAll('[data-slot="ask-uni-attachment"] img')).toHaveLength(2));
      expect(downloadAskAttachment).toHaveBeenCalledTimes(1);
      expect(downloadAskAttachment).toHaveBeenCalledWith("ws1", "att2");
      expect(URL.createObjectURL).toHaveBeenCalledWith(picture);
    });

    it("waits for a stored picture to scroll into view, and keeps the image icon when it cannot be loaded", async () => {
      vi.mocked(downloadAskAttachment).mockRejectedValue(new ApiError("not found", "not_found", 404));
      let reveal: (() => void) | undefined;
      const Real = globalThis.IntersectionObserver;
      globalThis.IntersectionObserver = class {
        constructor(private cb: IntersectionObserverCallback) {}
        observe(target: Element) {
          reveal = () => this.cb([{ isIntersecting: true, target } as IntersectionObserverEntry], this as never);
        }
        unobserve() {}
        disconnect() {}
        takeRecords() {
          return [];
        }
      } as never;
      try {
        mount(msg({ id: "u1", role: "user", content: "Q", attachments: [png] }), { wsId: "ws1" });
        await act(async () => {});
        expect(downloadAskAttachment).not.toHaveBeenCalled();
        act(() => reveal!());
        await waitFor(() => expect(downloadAskAttachment).toHaveBeenCalledWith("ws1", "att2"));
        await act(async () => {});
        expect(document.querySelector('[data-slot="ask-uni-attachment"] img')).toBeNull();
        expect(document.querySelector('[data-slot="ask-uni-attachment"] .lucide-image')).not.toBeNull();
        expect(toast.error).not.toHaveBeenCalled();
      } finally {
        globalThis.IntersectionObserver = Real;
      }
    });

    it("says in words when a file cannot be downloaded", async () => {
      vi.mocked(downloadAskAttachment).mockRejectedValue(new ApiError("not found", "not_found", 404));
      mount(msg({ id: "u1", role: "user", content: "Q", attachments: [pdf] }), { wsId: "ws1" });
      fireEvent.click(screen.getByRole("button", { name: "Tải bao-cao.pdf" }));
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Không tải được bao-cao.pdf, thử lại nhé."));
    });

    it.each([
      ["a question the stream is still answering", "live-question"],
      ["the echo the cache holds until the refetch", "pending-a2"],
    ])("shows the files of %s without a way to download them", (_n, id) => {
      mount(msg({ id, role: "user", content: "Q", attachments: [pdf] }), { wsId: "ws1" });
      expect(screen.getByText("bao-cao.pdf")).toBeInTheDocument();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("draws nothing for a question without files", () => {
      mount(msg({ id: "u1", role: "user", content: "Q" }), { wsId: "ws1" });
      expect(screen.queryByRole("list")).toBeNull();
    });
  });

  describe("what UNI read of the files", () => {
    const note = (over: Partial<AiFileNote> = {}): AiFileNote => ({ name: "bao-cao.pdf", unit: "page", read: 15, total: 80, ...over });
    it("writes one note per file UNI read only in part", () => {
      mount(msg({ content: "Tóm tắt đây.", file_notes: [note(), note({ name: "so-lieu.xlsx", unit: "row", read: 200, total: 5000 })] }));
      expect(screen.getByText("UNI đã đọc trang 1–15 trên 80 trang của bao-cao.pdf")).toBeInTheDocument();
      expect(screen.getByText("UNI đã đọc 200 trên 5000 dòng của so-lieu.xlsx")).toBeInTheDocument();
    });

    it("wraps a note with a long unbroken name instead of overflowing the dock", () => {
      mount(msg({ content: "ok", file_notes: [note({ name: "a".repeat(200) + ".pdf" })] }));
      expect(screen.getByText(/UNI đã đọc trang 1–15/)).toHaveClass("break-words");
    });

    it.each([
      ["page", "UNI đã đọc trang 1–3 trên 9 trang của f"],
      ["slide", "UNI đã đọc slide 1–3 trên 9 slide của f"],
      ["row", "UNI đã đọc 3 trên 9 dòng của f"],
      ["paragraph", "UNI đã đọc đoạn 1–3 trên 9 đoạn của f"],
      ["line", "UNI đã đọc dòng 1–3 trên 9 dòng của f"],
    ])("words a %s count", (unit, line) => {
      mount(msg({ content: "ok", file_notes: [note({ name: "f", unit, read: 3, total: 9 })] }));
      expect(screen.getByText(line)).toBeInTheDocument();
    });

    it.each([
      ["page", "UNI đã đọc trang 1 trên 9 trang của f"],
      ["slide", "UNI đã đọc slide 1 trên 9 slide của f"],
      ["row", "UNI đã đọc 1 trên 9 dòng của f"],
      ["paragraph", "UNI đã đọc đoạn 1 trên 9 đoạn của f"],
      ["line", "UNI đã đọc dòng 1 trên 9 dòng của f"],
    ])("words one %s read without a range", (unit, line) => {
      mount(msg({ content: "ok", file_notes: [note({ name: "f", unit, read: 1, total: 9 })] }));
      expect(screen.getByText(line)).toBeInTheDocument();
    });

    it("says only the start was read when not even one whole unit fit", () => {
      mount(msg({ content: "ok", file_notes: [note({ read: 0 })] }));
      expect(screen.getByText("UNI chỉ đọc được phần đầu của bao-cao.pdf")).toBeInTheDocument();
    });

    it("falls back to the same general line for a unit it does not know", () => {
      mount(msg({ content: "ok", file_notes: [note({ unit: "sheet" })] }));
      expect(screen.getByText("UNI chỉ đọc được phần đầu của bao-cao.pdf")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/read_note/);
    });

    it("reads right in English, one unit read apart from several", async () => {
      await setLocale("en");
      mount(
        msg({
          content: "ok",
          file_notes: [
            note({ read: 15 }),
            note({ name: "a.pdf", read: 1 }),
            note({ name: "b.pdf", unit: "slide", read: 4, total: 30 }),
            note({ name: "c.pdf", read: 0 }),
            note({ name: "d.xlsx", unit: "row", read: 1, total: 40 }),
            note({ name: "e.xlsx", unit: "row", read: 12, total: 40 }),
          ],
        }),
      );
      expect(screen.getByText("UNI read pages 1–15 of 80 in bao-cao.pdf")).toBeInTheDocument();
      expect(screen.getByText("UNI read page 1 of 80 in a.pdf")).toBeInTheDocument();
      expect(screen.getByText("UNI read slides 1–4 of 30 in b.pdf")).toBeInTheDocument();
      expect(screen.getByText("UNI read only the start of c.pdf")).toBeInTheDocument();
      expect(screen.getByText("UNI read 1 of 40 rows in d.xlsx")).toBeInTheDocument();
      expect(screen.getByText("UNI read 12 of 40 rows in e.xlsx")).toBeInTheDocument();
    });

    it("writes no note when every file was read whole", () => {
      mount(msg({ content: "Tóm tắt đây.", file_notes: [] }));
      expect(screen.getByText("Tóm tắt đây.")).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/UNI đã đọc|UNI chỉ đọc/);
    });
  });
});

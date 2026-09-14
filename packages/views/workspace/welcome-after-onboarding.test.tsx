import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { resetWelcome, setWelcomeSignal } from "@uniwork/core/onboarding";
import { requestMock, wrap } from "../test/api-mock";
import { WelcomeAfterOnboarding } from "./welcome-after-onboarding";

initI18n();
beforeEach(() => {
  requestMock.mockReset();
  resetWelcome();
});
const ws = { id: "w1", slug: "a", name: "A", organization_id: "o", organization_slug: "o", organization_name: "O" };
const task = { id: "t1", workspace_id: "w1", title: "Bắt đầu với UniWork", description: "", status: "in_progress", priority: "high", position: 1, created_by: "u", created_at: "", updated_at: "", kind: "welcome" };

describe("WelcomeAfterOnboarding", () => {
  it("renders nothing without signal", () => {
    const { container } = render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={() => {}} />));
    expect(container).toBeEmptyDOMElement();
  });
  it("seeds task then shows welcome dialog; primary button opens task", async () => {
    requestMock.mockResolvedValueOnce({ task });
    setWelcomeSignal("w1");
    const onOpenTask = vi.fn();
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={onOpenTask} />));
    const open = await screen.findByRole("button", { name: "Mở task hướng dẫn" });
    expect(screen.getAllByText("Chào mừng đến UniWork!").length).toBeGreaterThan(0);
    fireEvent.click(open);
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });
  /** Thẻ trông như một thẻ task nên phải bấm được — bản cũ trơ, người dùng bấm vào không có gì xảy ra. */
  it("the guide card is itself a button that opens the task", async () => {
    requestMock.mockResolvedValueOnce({ task });
    setWelcomeSignal("w1");
    const onOpenTask = vi.fn();
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={onOpenTask} />));
    const card = await screen.findByRole("button", { name: /Bắt đầu với UniWork/ });
    fireEvent.click(card);
    expect(onOpenTask).toHaveBeenCalledWith("t1");
  });
  /** Hai span khối không tự chèn khoảng trắng khi ghép tên khả truy cập: thiếu
   *  aria-label, trình đọc màn hình đọc liền thành "UniWorkTạo việc". */
  it("separates title from description in the card's accessible name", async () => {
    requestMock.mockResolvedValueOnce({ task });
    setWelcomeSignal("w1");
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={() => {}} />));
    const card = await screen.findByRole("button", { name: /Bắt đầu với UniWork/ });
    const name = card.getAttribute("aria-label") ?? "";
    expect(name).toMatch(/^Bắt đầu với UniWork\./);
    expect(name).not.toMatch(/UniWorkTạo/);
  });
  /** Seed chạy bao lâu cũng không phải lý do giam người dùng trong hộp. */
  it("lets the user leave while the guide task is still being seeded", async () => {
    requestMock.mockReturnValueOnce(new Promise(() => {}));
    setWelcomeSignal("w1");
    const onOpenTask = vi.fn();
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={onOpenTask} />));
    fireEvent.click(await screen.findByRole("button", { name: "Để sau" }));
    expect(onOpenTask).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
  /** Bản cũ có nút X đóng mà không mở task, khác kết cục với nút chính. Mọi lối thoát giờ đều có nhãn. */
  it("dismisses without opening the task, and offers no unlabelled exit", async () => {
    requestMock.mockResolvedValueOnce({ task });
    setWelcomeSignal("w1");
    const onOpenTask = vi.fn();
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={onOpenTask} />));
    const later = await screen.findByRole("button", { name: "Để sau" });
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    fireEvent.click(later);
    expect(onOpenTask).not.toHaveBeenCalled();
  });
  it("shows retry dialog on failure", async () => {
    requestMock.mockRejectedValueOnce(new Error("x"));
    setWelcomeSignal("w1");
    render(wrap(<WelcomeAfterOnboarding workspace={ws} onOpenTask={() => {}} />));
    expect(await screen.findByRole("button", { name: "Thử lại" })).toBeInTheDocument();
    expect(screen.getAllByText("Chưa chuẩn bị được workspace").length).toBeGreaterThan(0);
  });
});

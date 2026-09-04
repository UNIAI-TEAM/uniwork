import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatComposer } from "./chat-composer";

initI18n();

vi.mock("sonner", () => ({
  toast: { info: vi.fn() },
}));

describe("ChatComposer", () => {
  it("renders composer toolbar and opens attach menu", async () => {
    const onDraftChange = vi.fn();
    const onSend = vi.fn();

    render(
      <ChatComposer
        draft=""
        onDraftChange={onDraftChange}
        onSend={onSend}
        placeholder="Nhập tin nhắn…"
        sendLabel="Gửi"
      />,
    );

    expect(screen.getByLabelText("Đính kèm")).toBeInTheDocument();
    expect(screen.getByLabelText("Tin nhắn thoại")).toBeInTheDocument();
    expect(screen.queryByLabelText("Thêm")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Đính kèm"));
    expect(await screen.findByRole("menuitem", { name: "Nhãn dán" })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: "Bỏ phiếu" })).toBeInTheDocument();
  });

  it("submits on Enter and shows send when draft has text", () => {
    const onSend = vi.fn();

    render(
      <ChatComposer
        draft="hello"
        onDraftChange={vi.fn()}
        onSend={onSend}
        placeholder="Nhập tin nhắn…"
        sendLabel="Gửi"
      />,
    );

    expect(screen.getByRole("button", { name: "Gửi" })).toBeInTheDocument();

    fireEvent.keyDown(screen.getByLabelText("Nhập tin nhắn…"), { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

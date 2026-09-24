import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatCreateReminderDialog } from "./chat-create-reminder-dialog";

const mutateAsync = vi.fn().mockResolvedValue({ id: "msg1" });

vi.mock("@uniwork/core/chat", () => ({
  useSendChatRoomMessage: () => ({
    mutateAsync,
    isPending: false,
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

beforeAll(() => {
  initI18n();
});

describe("ChatCreateReminderDialog", () => {
  it("creates a reminder through the chat API", async () => {
    mutateAsync.mockClear();

    render(
      wrap(
        <ChatCreateReminderDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
        />,
      ),
    );

    fireEvent.change(screen.getByRole("textbox", { name: /Nhập nội dung/ }), {
      target: { value: "Họp lúc 9h" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhắc hẹn" }));

    await waitFor(() => {
      expect(mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({
          roomId: "room1",
          reminder: expect.objectContaining({
            body: "Họp lúc 9h",
            repeat: "none",
          }),
        }),
      );
    });
  });

  it("shows custom datetime picker when Other is selected", () => {
    render(
      wrap(
        <ChatCreateReminderDialog
          open
          onOpenChange={vi.fn()}
          workspaceId="ws1"
          roomId="room1"
        />,
      ),
    );

    expect(screen.getByRole("button", { name: "30 phút nữa" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Khác" }));
    expect(screen.getByRole("button", { name: "Khác" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "30 phút nữa" })).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Chọn ngày nhắc hẹn")).toBeInTheDocument();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts a preset from the moment of sending, not from when it was picked", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const opened = new Date(2026, 8, 23, 10, 0, 0);
    vi.setSystemTime(opened);
    mutateAsync.mockClear();
    render(wrap(<ChatCreateReminderDialog open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" />));
    fireEvent.change(screen.getByRole("textbox", { name: /Nhập nội dung/ }), { target: { value: "Gọi khách" } });

    // The dialog sat open for 20 minutes before Create.
    vi.setSystemTime(new Date(opened.getTime() + 20 * 60_000));
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhắc hẹn" }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
    const sent = mutateAsync.mock.calls.at(-1)?.[0] as { reminder: { remind_at: string } };
    expect(Date.parse(sent.reminder.remind_at)).toBeGreaterThanOrEqual(opened.getTime() + 50 * 60_000);
  });

  it("says which time zone a custom time is in", () => {
    render(wrap(<ChatCreateReminderDialog open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" />));
    fireEvent.click(screen.getByRole("button", { name: "Khác" }));
    expect(screen.getByText(/^Theo giờ /)).toBeInTheDocument();
  });

  it("explains a disabled Create and shows a failed send inline", async () => {
    mutateAsync.mockClear();
    mutateAsync.mockRejectedValueOnce(new Error("raw"));
    render(wrap(<ChatCreateReminderDialog open onOpenChange={vi.fn()} workspaceId="ws1" roomId="room1" />));
    expect(screen.getByText("Cần nội dung nhắc hẹn")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: /Nhập nội dung/ }), { target: { value: "Họp" } });
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhắc hẹn" }));
    const alert = await screen.findByRole("alert");
    expect(alert).not.toHaveTextContent("raw");
  });
});

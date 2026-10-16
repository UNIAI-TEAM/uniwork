import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatReminderMessageRow } from "./chat-reminder-message-row";

beforeAll(() => {
  initI18n();
});

const reminder = { body: "Họp hằng ngày", remindAt: "2099-01-01T09:00:00Z", repeat: "daily" as const };

describe("ChatReminderMessageRow", () => {
  it("offers delete only to someone who may delete it", async () => {
    const onDelete = vi.fn();
    const label = "Xóa nhắc hẹn";
    const { rerender } = render(<ChatReminderMessageRow reminder={reminder} senderLabel="An" />);
    expect(screen.queryByRole("button", { name: label })).toBeNull();

    rerender(<ChatReminderMessageRow reminder={reminder} senderLabel="An" onDelete={onDelete} />);
    await userEvent.click(screen.getByRole("button", { name: label }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});

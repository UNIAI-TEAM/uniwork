import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { DmSettingsSheet } from "./dm-settings-sheet";

beforeAll(() => {
  initI18n();
});

const contact = {
  user_id: "u2",
  email: "binh@example.com",
  display_name: "Binh",
};

describe("DmSettingsSheet", () => {
  it("lists dm participants", () => {
    render(
      wrap(
        <DmSettingsSheet
          open
          onOpenChange={vi.fn()}
          contact={contact}
          youLabel="Bạn"
          onLeave={vi.fn()}
          blockedByMe={false}
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
        />,
      ),
    );

    expect(screen.getByRole("heading", { name: "Binh" })).toBeInTheDocument();
    expect(screen.getByText("Người tham gia")).toBeInTheDocument();
  });

  it("confirms leaving the conversation", () => {
    const onLeave = vi.fn();
    render(
      wrap(
        <DmSettingsSheet
          open
          onOpenChange={vi.fn()}
          contact={contact}
          youLabel="Bạn"
          onLeave={onLeave}
          blockedByMe={false}
          blockedMe={false}
          onBlock={vi.fn()}
          onUnblock={vi.fn()}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Rời cuộc trò chuyện" }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Rời cuộc trò chuyện" }));
    expect(onLeave).toHaveBeenCalled();
  });
});

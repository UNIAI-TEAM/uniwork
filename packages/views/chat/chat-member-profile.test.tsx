import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import { ChatPersonMessageProvider } from "./chat-person-card";
import { ChatMemberRow } from "./chat-settings-ui";

initI18n();

describe("ChatMemberRow profile", () => {
  it("opens the address and a direct-message action", async () => {
    const onMessage = vi.fn();
    render(
      wrap(
        <ChatMemberRow
          avatar={<span aria-hidden>T</span>}
          name="Trà My Đào"
          detail="Quản trị phòng"
          profile={{ email: "dtramy28@gmail.com", onMessage }}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Trà My Đào" }));
    expect(await screen.findByText("dtramy28@gmail.com")).toBeInTheDocument();
    expect(screen.getAllByText("Quản trị phòng").length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "Nhắn tin" }));
    expect(onMessage).toHaveBeenCalledTimes(1);
  });

  it("shows the address without a direct message for yourself", async () => {
    render(
      wrap(
        <ChatMemberRow
          avatar={<span aria-hidden>B</span>}
          name="Bạn"
          detail="longthldz@gmail.com"
          profile={{ email: "longthldz@gmail.com" }}
        />,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Bạn" }));
    expect((await screen.findAllByText("longthldz@gmail.com")).length).toBeGreaterThan(1);
    expect(screen.queryByRole("button", { name: "Nhắn tin" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gọi" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Video" })).not.toBeInTheDocument();
  });

  it("rings a direct call from the card", async () => {
    const onCall = vi.fn();
    render(
      wrap(
        <ChatPersonMessageProvider onMessage={null} onCall={onCall}>
          <ChatMemberRow
            avatar={<span aria-hidden>T</span>}
            name="Trà My Đào"
            detail="Quản trị phòng"
            profile={{ userId: "user-tra", email: "dtramy28@gmail.com", onMessage: vi.fn() }}
          />
        </ChatPersonMessageProvider>,
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Trà My Đào" }));
    fireEvent.click(await screen.findByRole("button", { name: "Gọi" }));
    expect(onCall).toHaveBeenCalledWith("user-tra", undefined);
    fireEvent.click(screen.getByRole("button", { name: "Xem thông tin của Trà My Đào" }));
    fireEvent.click(await screen.findByRole("button", { name: "Video" }));
    expect(onCall).toHaveBeenLastCalledWith("user-tra", { withCamera: true });
  });
});

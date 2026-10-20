import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ChatConversationIntro, ChatIntroCompactContext } from "./chat-conversation-intro";

const intro = (
  <ChatConversationIntro
    mark={<span data-testid="mark" />}
    title="Đây là khởi đầu của #doanh-so"
    description="Số liệu bán hàng"
    actions={<button type="button">Thêm thành viên</button>}
  />
);

describe("ChatConversationIntro", () => {
  it("is the full card in an empty room", () => {
    render(intro);
    expect(screen.getByRole("heading", { name: "Đây là khởi đầu của #doanh-so" })).toBeInTheDocument();
    expect(screen.getByText("Số liệu bán hàng")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Thêm thành viên" })).toBeInTheDocument();
  });

  it("shrinks to one line above a history that has messages", () => {
    render(<ChatIntroCompactContext.Provider value>{intro}</ChatIntroCompactContext.Provider>);
    expect(screen.getByRole("heading", { name: "Đây là khởi đầu của #doanh-so" })).toBeInTheDocument();
    expect(screen.queryByText("Số liệu bán hàng")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByTestId("mark")).not.toBeInTheDocument();
  });
});

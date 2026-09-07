import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatMessageBody } from "./chat-message-body";

initI18n();

describe("ChatMessageBody", () => {
  it("renders plain text without markdown wrapper", () => {
    render(<ChatMessageBody body="hello world" isOwn={false} nameContext={[]} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("renders member mention with display name from context", () => {
    render(
      <ChatMessageBody
        body="[@Binh](mention://member/u2) check this"
        isOwn={false}
        nameContext={[{ user_id: "u2", display_name: "Binh" }]}
      />,
    );
    expect(screen.getByText("@Binh")).toBeInTheDocument();
    expect(screen.getByText(/check this/)).toBeInTheDocument();
  });

  it("renders sticker media messages as images", () => {
    render(
      <ChatMessageBody
        body="![sticker:cười](https://cdn.example/sticker.png)"
        isOwn={false}
        nameContext={[]}
      />,
    );
    expect(screen.getByRole("img")).toHaveAttribute("src", "https://cdn.example/sticker.png");
  });
});

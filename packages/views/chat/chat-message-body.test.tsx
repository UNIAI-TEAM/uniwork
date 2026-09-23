import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatMessageBody } from "./chat-message-body";

initI18n();

describe("ChatMessageBody", () => {
  it("renders plain text without markdown wrapper", () => {
    render(<ChatMessageBody body="hello world" isOwn={false} nameContext={[]} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("draws a sticker at once as an image named in words, and says so when it cannot load", () => {
    render(
      <ChatMessageBody body="![sticker:ăn mừng](https://media.giphy.com/a/giphy.gif)" isOwn nameContext={[]} />,
    );
    // No markdown chunk to wait for: the image is there on the first render.
    const img = screen.getByRole("img", { name: "Nhãn dán · ăn mừng" });
    expect(img).toHaveAttribute("src", "https://media.giphy.com/a/giphy.gif");
    fireEvent.error(img);
    expect(screen.getByText("Không tải được Nhãn dán · ăn mừng")).toBeInTheDocument();
  });

  it("turns web addresses into links and leaves trailing punctuation outside", () => {
    render(
      <ChatMessageBody body="Xem https://docs.example.com/a?b=1. rồi báo nhé" isOwn nameContext={[]} />,
    );
    const link = screen.getByRole("link", { name: "https://docs.example.com/a?b=1" });
    expect(link).toHaveAttribute("href", "https://docs.example.com/a?b=1");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link.closest("p")).toHaveTextContent("Xem https://docs.example.com/a?b=1. rồi báo nhé");
  });

  it("renders member mention with display name from context", async () => {
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

  it("renders a message with a mention the same way as one without: links still work, no markup shows", () => {
    render(
      <ChatMessageBody
        body="[@Binh](mention://member/u2) xem https://a.example/x nhé"
        isOwn={false}
        nameContext={[{ user_id: "u2", display_name: "Binh" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "https://a.example/x" })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("mention://");
  });

  it("names someone who left by the label written into the message, never their id", () => {
    render(<ChatMessageBody body="[@Lan cũ](mention://member/01J8ABC) cảm ơn" isOwn nameContext={[]} />);
    expect(screen.getByText("@Lan cũ")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("01J8ABC");
  });

  it("lets a GIF be paused", () => {
    render(<ChatMessageBody body="![gif:vui](https://media.example/v.gif)" isOwn nameContext={[]} />);
    const pause = screen.getByRole("button", { name: /Dừng ảnh động/ });
    fireEvent.click(pause);
    expect(screen.getByRole("button", { name: /Phát ảnh động/ })).toBeInTheDocument();
  });

  it("renders sticker media messages as images", async () => {
    render(
      <ChatMessageBody
        body="![sticker:cười](https://cdn.example/sticker.png)"
        isOwn={false}
        nameContext={[]}
      />,
    );
    expect(await screen.findByRole("img")).toHaveAttribute(
      "src",
      "https://cdn.example/sticker.png",
    );
  });
});

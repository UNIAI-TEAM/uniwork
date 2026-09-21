import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { ChatMessageBody } from "./chat-message-body";

initI18n();

describe("ChatMessageBody", () => {
  // Importing the markdown chunk (KaTeX, Shiki) costs seconds while the whole
  // suite runs in parallel under coverage. Warming the module registry here
  // keeps the lazy boundary in the assertions without timing the import.
  beforeAll(async () => {
    await import("@uniwork/ui/markdown");
  }, 60_000);

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

  // The markdown renderer is lazy (it carries KaTeX and Shiki), so these two
  // wait for the chunk; the plain-text case above renders synchronously.
  // The renderer stays behind Suspense even with the module warmed, so these
  // two still await the boundary.
  // Loading that chunk takes longer than the one-second default while the whole
  // suite runs in parallel under coverage, and under `make check` several view
  // suites compile at once and the on-demand compile is measured past 8s — see
  // date-field.test.tsx.
  const CHUNK_LOAD = { timeout: 20_000 };

  it("renders member mention with display name from context", async () => {
    render(
      <ChatMessageBody
        body="[@Binh](mention://member/u2) check this"
        isOwn={false}
        nameContext={[{ user_id: "u2", display_name: "Binh" }]}
      />,
    );
    expect(await screen.findByText("@Binh", undefined, CHUNK_LOAD)).toBeInTheDocument();
    expect(screen.getByText(/check this/)).toBeInTheDocument();
  });

  it("renders sticker media messages as images", async () => {
    render(
      <ChatMessageBody
        body="![sticker:cười](https://cdn.example/sticker.png)"
        isOwn={false}
        nameContext={[]}
      />,
    );
    expect(await screen.findByRole("img", undefined, CHUNK_LOAD)).toHaveAttribute(
      "src",
      "https://cdn.example/sticker.png",
    );
  });
});

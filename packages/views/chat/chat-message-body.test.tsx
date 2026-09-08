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

  // The markdown renderer is lazy (it carries KaTeX and Shiki), so these two
  // wait for the chunk; the plain-text case above renders synchronously.
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

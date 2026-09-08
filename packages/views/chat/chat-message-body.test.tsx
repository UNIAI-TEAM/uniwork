import { render, screen } from "@testing-library/react";
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
  });

  it("renders plain text without markdown wrapper", () => {
    render(<ChatMessageBody body="hello world" isOwn={false} nameContext={[]} />);
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  // The renderer stays behind Suspense even with the module warmed, so these
  // two still await the boundary; the plain-text case above renders synchronously.
  const CHUNK_LOAD = { timeout: 5_000 };
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

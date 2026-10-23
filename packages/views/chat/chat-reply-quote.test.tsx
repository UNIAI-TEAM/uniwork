import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { wrap } from "../test/api-mock";
import type { ChatMessage } from "./chat-messages";
import { ChatReplyQuote, replyPreviewLabel } from "./chat-reply-quote";

initI18n();

const inAnHour = () => new Date(Date.now() + 3_600_000).toISOString();

const imageMessage = (urlExpiresAt: string = inAnHour()): ChatMessage => ({
  id: "img1",
  sender: "u1",
  body: "photo.png",
  kind: "file",
  ts: Date.now(),
  reactions: {},
  file: {
    filename: "photo.png",
    content_type: "image/png",
    size_bytes: 1200,
    url: "https://storage.test/photo.png",
    thumb_url: "https://storage.test/photo-thumb.png",
    url_expires_at: urlExpiresAt,
  },
});

describe("chat-reply-quote", () => {
  it("labels voice and file replies", () => {
    expect(
      replyPreviewLabel(
        { id: "v1", sender: "u1", body: "", kind: "voice", ts: 1, reactions: {} },
        { voice: "Tin nhắn thoại", file: "Tệp" },
      ),
    ).toBe("Tin nhắn thoại");
    expect(
      replyPreviewLabel(imageMessage(), { voice: "Tin nhắn thoại", file: "Tệp" }),
    ).toBe("photo.png");
    expect(
      replyPreviewLabel(
        {
          id: "f1",
          sender: "u1",
          body: "fallback.pdf",
          kind: "file",
          ts: 1,
          reactions: {},
          file: { filename: "  ", content_type: "application/pdf", size_bytes: 1 },
        },
        { voice: "Tin nhắn thoại", file: "Tệp" },
      ),
    ).toBe("fallback.pdf");
    expect(
      replyPreviewLabel(
        { id: "t1", sender: "u1", body: "  hi  ", kind: "text", ts: 1, reactions: {} },
        { voice: "Tin nhắn thoại", file: "Tệp" },
      ),
    ).toBe("hi");
  });

  it("shows the signed thumbnail for image replies", () => {
    render(wrap(<ChatReplyQuote message={imageMessage()} isOwn />));

    expect(screen.getByRole("img", { name: "photo.png" })).toHaveAttribute(
      "src",
      "https://storage.test/photo-thumb.png",
    );
    expect(screen.getByText("photo.png")).toBeInTheDocument();
  });

  it("renders compact image placeholder for an expired URL and peer file quote", () => {
    render(wrap(<ChatReplyQuote message={imageMessage("2020-01-01T00:00:00Z")} isOwn={false} compact />));
    expect(screen.getByText(/Trả lời:/i)).toBeInTheDocument();
    expect(screen.queryByRole("img", { name: "photo.png" })).not.toBeInTheDocument();

    render(
      wrap(
        <ChatReplyQuote
          message={{
            id: "pdf1",
            sender: "u1",
            body: "a.pdf",
            kind: "file",
            ts: 1,
            reactions: {},
            file: { filename: "a.pdf", content_type: "application/pdf", size_bytes: 1 },
          }}
          isOwn={false}
        />,
      ),
    );
    // A quoted file names its size too (canvas).
    expect(screen.getByText("a.pdf · 1 B")).toBeInTheDocument();
  });
});

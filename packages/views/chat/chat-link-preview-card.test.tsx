import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatLinkPreviewCard } from "./chat-link-preview-card";

const FRESH = new Date(Date.now() + 60 * 60 * 1000).toISOString();

const PREVIEW = {
  message_id: "m1",
  url: "https://uniwork.vn/blog/ra-mat-q4",
  title: "UniWork Q4: làm việc cùng AI cho đội nhóm Việt",
  description: "Việc, cuộc họp, tài liệu và quy trình ở một nơi.",
  site_name: "uniwork.vn",
  image_url: "https://storage.test/chat/link-previews/f1?sig=1",
  image_url_expires_at: FRESH,
};

describe("ChatLinkPreviewCard", () => {
  it("opens the link and shows the site, title, description and stored picture", () => {
    const { container } = render(<ChatLinkPreviewCard preview={PREVIEW} isOwn={false} />);
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", PREVIEW.url);
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveTextContent("uniwork.vn");
    expect(link).toHaveTextContent(PREVIEW.title);
    expect(link).toHaveTextContent(PREVIEW.description);
    expect(container.querySelector("img")).toHaveAttribute("src", PREVIEW.image_url);
  });

  it("drops a picture whose signature expired and a link that is not http(s)", () => {
    const { container } = render(
      <ChatLinkPreviewCard
        preview={{ ...PREVIEW, url: "javascript:alert(1)", image_url_expires_at: "2020-01-01T00:00:00Z" }}
        isOwn
      />,
    );
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("a")).not.toHaveAttribute("href");
  });
});

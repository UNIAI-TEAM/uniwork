import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ReadonlyContent } from "./readonly-content";

vi.mock("./attachment", () => ({
  Attachment: ({
    attachment,
  }: {
    attachment: { kind: string; url?: string; filename?: string };
  }) => (
    <img
      data-testid="rendered-attachment"
      src={attachment.url}
      alt={attachment.filename ?? ""}
    />
  ),
}));

vi.mock("./attachment-download-context", () => ({
  AttachmentDownloadProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe("ReadonlyContent", () => {
  it("renders markdown images instead of dumping the source string", async () => {
    render(
      <ReadonlyContent content={"hello\n\n![shot.webp](/api/v1/attachments/a1/download)"} />,
    );
    expect(screen.queryByText(/!\[shot\.webp\]/)).toBeNull();
    expect(await screen.findByTestId("rendered-attachment")).toHaveAttribute(
      "src",
      "/api/v1/attachments/a1/download",
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
  });

  it("renders a blockquote as a quote, not as a leading > glyph", async () => {
    render(<ReadonlyContent content={"> quoted line"} />);
    expect(screen.queryByText(/^>\s/)).toBeNull();
    expect(await screen.findByText("quoted line")).toBeInTheDocument();
  });
});

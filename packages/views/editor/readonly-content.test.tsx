import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { fakeNav, wrapWithNav } from "../test/api-mock";
import { EditorLinkProvider } from "./editor-link-context";
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

describe("ReadonlyContent link context (DOC7-W03)", () => {
  const body =
    "[spec](/acme/eng/documents/D1) [t](/acme/eng/tasks/UNI-0) [pr](https://example.com/x)";

  function mount(withContext: boolean) {
    const nav = fakeNav("/acme/eng/tasks/t1");
    const content = <ReadonlyContent content={body} />;
    render(
      wrapWithNav(
        withContext ? (
          <EditorLinkProvider value={{ kind: "task", id: "t1" }}>{content}</EditorLinkProvider>
        ) : (
          content
        ),
        nav,
      ),
    );
    return nav;
  }

  async function click(name: string) {
    const link = await screen.findByRole("link", { name });
    act(() => {
      fireEvent.click(link);
    });
  }

  it("tags an internal document link with ?from=task:<id> when a context is set", async () => {
    const nav = mount(true);
    await click("spec");
    expect(nav.push).toHaveBeenCalledWith("/acme/eng/documents/D1?from=task:t1");
  });

  it("does not tag a non-document internal link", async () => {
    const nav = mount(true);
    await click("t");
    expect(nav.push).toHaveBeenCalledWith("/acme/eng/tasks/UNI-0");
  });

  it("opens an external link in a new tab untouched", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const nav = mount(true);
    await click("pr");
    expect(nav.push).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("https://example.com/x", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });

  it("keeps the plain new-tab open when no context is set", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const nav = mount(false);
    await click("spec");
    expect(nav.push).not.toHaveBeenCalled();
    expect(open).toHaveBeenCalledWith("/acme/eng/documents/D1", "_blank", "noopener,noreferrer");
    open.mockRestore();
  });
});

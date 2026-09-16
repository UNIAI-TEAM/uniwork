import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { createRef, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { ContentEditor, type ContentEditorRef } from "./content-editor";

function wrap(ui: ReactNode) {
  return (
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>
  );
}

describe("ContentEditor", () => {
  it("mounts a contenteditable surface", async () => {
    const { container } = render(
      wrap(<ContentEditor defaultValue="Body" ariaLabel="Description" disableMentions />),
    );
    const surface = await waitFor(() => {
      const el = container.querySelector(".ProseMirror[contenteditable='true']");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(surface).toHaveAttribute("contenteditable", "true");
    expect(surface).toHaveAttribute("role", "textbox");
    expect(surface).toHaveAttribute("aria-label", "Description");
    expect(surface).toHaveAttribute("aria-multiline", "true");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });

  it("publishes the visible document before the persistence debounce", async () => {
    const ref = createRef<ContentEditorRef>();
    const onDocumentChange = vi.fn();
    const onUpdate = vi.fn();

    render(
      wrap(
        <ContentEditor
          ref={ref}
          defaultValue="Body"
          debounceMs={60_000}
          onDocumentChange={onDocumentChange}
          onUpdate={onUpdate}
          disableMentions
        />,
      ),
    );
    await waitFor(() => expect(ref.current).not.toBeNull());

    act(() => {
      expect(ref.current?.insertMarkdownAtEnd("![photo](/api/v1/attachments/a1/download)")).toBe(
        true,
      );
    });

    await waitFor(() => {
      expect(onDocumentChange).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/attachments/a1/download"),
      );
    });
    expect(onUpdate).not.toHaveBeenCalled();
  });
});

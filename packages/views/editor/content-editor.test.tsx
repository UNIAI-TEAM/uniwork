import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { ContentEditor } from "./content-editor";

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
    const { container } = render(wrap(<ContentEditor defaultValue="Body" disableMentions />));
    const surface = await waitFor(() => {
      const el = container.querySelector(".ProseMirror[contenteditable='true']");
      expect(el).toBeTruthy();
      return el as HTMLElement;
    });
    expect(surface).toHaveAttribute("contenteditable", "true");
    expect(screen.getByText("Body")).toBeInTheDocument();
  });
});

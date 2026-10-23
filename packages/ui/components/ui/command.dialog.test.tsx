// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { Command, CommandDialog, CommandInput, CommandList } from "./command";

/**
 * The palette's title names the dialog for a screen reader. Rendered outside
 * the popup it sat in the page as an h2 even while the palette was closed,
 * so every screen read "Tìm kiếm" (h2) before its own h1.
 */
describe("CommandDialog title", () => {
  beforeAll(() => {
    // cmdk measures its list; jsdom has no ResizeObserver.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
  });

  it("is not in the page while the palette is closed", () => {
    render(
      <CommandDialog open={false} title="Tìm kiếm" description="Tìm mọi thứ">
        <Command>
          <CommandInput />
          <CommandList />
        </Command>
      </CommandDialog>,
    );
    expect(screen.queryByRole("heading", { name: "Tìm kiếm" })).not.toBeInTheDocument();
  });

  it("names the open palette", async () => {
    render(
      <CommandDialog open title="Tìm kiếm" description="Tìm mọi thứ">
        <Command>
          <CommandInput />
          <CommandList />
        </Command>
      </CommandDialog>,
    );
    expect(await screen.findByRole("dialog", { name: "Tìm kiếm" })).toBeInTheDocument();
  });
});

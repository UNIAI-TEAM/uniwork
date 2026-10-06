import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import { PdfFindBar } from "./pdf-find-bar";
import type { PdfSearchHit } from "./types";

const hits: PdfSearchHit[] = [{ id: "1:0:3", page: 1, start: 0, end: 3, text: "one" }];

describe("PdfFindBar", () => {
  beforeEach(async () => { await setLocale("en"); });

  it("reports match count and delegates navigation", () => {
    const onNext = vi.fn();
    render(<PdfFindBar query="one" hits={hits} onQueryChange={vi.fn()} onNext={onNext} onPrevious={vi.fn()} />);
    expect(screen.getByText("1 of 1 matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next match" }));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it("keeps the count on one line and the input from stretching the whole bar", async () => {
    await setLocale("vi");
    render(<PdfFindBar query="one" hits={hits} onQueryChange={vi.fn()} onNext={vi.fn()} onPrevious={vi.fn()} />);
    const count = screen.getByText(/^1 trên 1/);
    expect(count).toHaveClass("whitespace-nowrap", "shrink-0");
    expect(screen.getByRole("textbox")).toHaveClass("max-w-64");
  });
});

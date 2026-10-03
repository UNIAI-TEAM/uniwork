import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PdfFindBar } from "./pdf-find-bar";
import type { PdfSearchHit } from "./types";

const hits: PdfSearchHit[] = [{ id: "1:0:3", page: 1, start: 0, end: 3, text: "one" }];

describe("PdfFindBar", () => {
  it("reports match count and delegates navigation", () => {
    const onNext = vi.fn();
    render(<PdfFindBar query="one" hits={hits} onQueryChange={vi.fn()} onNext={onNext} onPrevious={vi.fn()} />);
    expect(screen.getByText("office.pdf.search.matches")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "office.pdf.search.next" }));
    expect(onNext).toHaveBeenCalledOnce();
  });
});

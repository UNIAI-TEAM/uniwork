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
});

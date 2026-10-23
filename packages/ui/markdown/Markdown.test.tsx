import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Markdown } from "./Markdown";

const card = "!file[report.pdf](https://cdn.example.com/report.pdf)";

describe("Markdown file card", () => {
  it("names the icon-only download button after the file", () => {
    render(<Markdown fileDownloadLabel={(name) => `Tải ${name}`}>{card}</Markdown>);
    expect(screen.getByRole("button", { name: "Tải report.pdf" })).toBeTruthy();
  });

  it("falls back to the file name when the host passes no label", () => {
    // packages/ui has no i18n; the name is never empty, even untranslated.
    render(<Markdown>{card}</Markdown>);
    expect(screen.getByRole("button", { name: "report.pdf" })).toBeTruthy();
  });

  it("keeps a 44px target on coarse pointers", () => {
    render(<Markdown>{card}</Markdown>);
    const button = screen.getByRole("button", { name: "report.pdf" });
    expect(button.className).toContain("pointer-coarse:min-h-11");
    expect(button.className).toContain("pointer-coarse:min-w-11");
  });
});

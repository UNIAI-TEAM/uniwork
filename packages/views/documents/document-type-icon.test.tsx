import { render, screen } from "@testing-library/react";
import { setLocale } from "@uniwork/core/i18n";
import { describe, expect, it } from "vitest";
import { DocumentTypeIcon } from "./document-type-icon";
import { UniNoteIcon } from "./uninote-icon";

describe("DocumentTypeIcon accessible labels", () => {
  it.each(["en", "vi"] as const)("uses real %s translations for every format", async (locale) => {
    await setLocale(locale);
    const formats = ["docx", "xlsx", "pptx", "pdf", "md", "html", "unknown"];
    render(<>{formats.map((format) => <DocumentTypeIcon key={format} format={format} />)}</>);
    const icons = screen.getAllByRole("img");
    expect(icons).toHaveLength(formats.length);
    for (const icon of icons) {
      expect(icon).toHaveAccessibleName();
      expect(icon.getAttribute("aria-label")).not.toMatch(/documents\.|settings\./);
    }
    expect(icons[0]).toHaveAccessibleName(locale === "en" ? "Word document" : "Tài liệu Word");
  });
});

describe("DocumentTypeIcon UniNote kind", () => {
  it("draws the page kind with the UniNote glyph on a blue tint tile", async () => {
    await setLocale("en");
    const { container } = render(<DocumentTypeIcon format="page" className="size-7" />);
    const reference = render(<UniNoteIcon />).container.querySelector("svg");
    const svg = container.querySelector("svg");
    expect(svg?.innerHTML).toBe(reference?.innerHTML);
    expect(svg).toHaveAttribute("viewBox", "0 0 100 100");
    expect(screen.getByRole("img")).toHaveClass("size-7");
    const tile = svg?.parentElement;
    expect(tile).toHaveClass("bg-tint-blue", "text-tint-blue-foreground");
  });

  it("leaves the other kinds on their own marks", () => {
    const { container } = render(
      <>
        <DocumentTypeIcon format="docx" />
        <DocumentTypeIcon format="folder" />
        <DocumentTypeIcon format="file" />
      </>,
    );
    expect(container.querySelectorAll('svg[viewBox="0 0 100 100"]')).toHaveLength(0);
    expect(container.querySelector("svg.lucide-folder")).not.toBeNull();
  });
});

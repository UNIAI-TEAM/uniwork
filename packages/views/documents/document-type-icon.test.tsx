import { render, screen } from "@testing-library/react";
import { setLocale } from "@uniwork/core/i18n";
import { MARK_COMPACT } from "@uniwork/ui/brand/mark.generated";
import { describe, expect, it } from "vitest";
import { DocumentTypeIcon } from "./document-type-icon";
import { UniNoteIcon } from "./uninote-icon";

describe("DocumentTypeIcon accessible labels", () => {
  it.each(["en", "vi"] as const)("uses real %s translations for every format", async (locale) => {
    await setLocale(locale);
    const formats = ["docx", "xlsx", "pptx", "pdf", "md", "markdown", "txt", "text", "html", "google_doc", "google_sheet", "google_slide", "generic", "unknown"];
    render(<>{formats.map((format) => <DocumentTypeIcon key={format} format={format} />)}</>);
    const icons = screen.getAllByRole("img");
    expect(icons).toHaveLength(formats.length);
    for (const icon of icons) {
      expect(icon).toHaveAccessibleName();
      expect(icon.getAttribute("aria-label")).not.toMatch(/documents\.|settings\./);
    }
    expect(icons[0]).toHaveAccessibleName(locale === "en" ? "Word document" : "Tài liệu Word");
    expect(icons[5]).toHaveAccessibleName(locale === "en" ? "Markdown document" : "Tài liệu Markdown");
    expect(icons[6]).toHaveAccessibleName(locale === "en" ? "Plain text file" : "Tệp văn bản");
    expect(icons[6]).toHaveClass("lucide-file-text");
    expect(icons[7]).toHaveAccessibleName(locale === "en" ? "Plain text file" : "Tệp văn bản");
    expect(icons[7]).toHaveClass("lucide-file-text");
    expect(icons[9]).toHaveAccessibleName("Google Docs");
    expect(icons[10]).toHaveAccessibleName("Google Sheets");
    expect(icons[11]).toHaveAccessibleName("Google Slides");
    expect(icons[12]).toHaveAccessibleName("File");
  });
});

describe("DocumentTypeIcon UniNote kind", () => {
  it("draws the page kind with the UniNote tile, filling the box like the other marks", async () => {
    await setLocale("en");
    const { container } = render(<DocumentTypeIcon format="page" className="size-7" />);
    const reference = render(<UniNoteIcon />).container.querySelector("svg");
    const svg = container.querySelector("svg");
    expect(svg).toHaveAttribute("viewBox", reference?.getAttribute("viewBox"));
    expect(svg?.querySelector("g[transform] path")).toHaveAttribute("d", MARK_COMPACT.ribbon);
    expect(svg).toHaveClass("size-full");
    expect(screen.getByRole("img")).toHaveClass("size-7");
    expect(container.querySelector(".bg-tint-blue")).toBeNull();
  });

  it("leaves the other kinds on their own marks", () => {
    const { container } = render(
      <>
        <DocumentTypeIcon format="docx" />
        <DocumentTypeIcon format="folder" />
        <DocumentTypeIcon format="file" />
      </>,
    );
    expect(container.querySelectorAll('svg[viewBox="0 0 240 240"] g[transform]')).toHaveLength(0);
    expect(container.querySelector("svg.lucide-folder")).not.toBeNull();
  });
});

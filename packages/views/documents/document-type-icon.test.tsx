import { render, screen } from "@testing-library/react";
import { setLocale } from "@uniwork/core/i18n";
import { describe, expect, it } from "vitest";
import { DocumentTypeIcon } from "./document-type-icon";

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

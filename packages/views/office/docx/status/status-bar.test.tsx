import { Editor } from "@tiptap/core";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { docxExtensions } from "../docx-schema";
import {
  DocxStatusBar,
  documentLanguageLabel,
  type DocxStatusBarProps,
  type DocxStatusCounts,
  type DocxStatusPage,
} from "./index";

initI18n();

beforeEach(async () => {
  await setLocale("en");
});

function renderBar(props: DocxStatusBarProps) {
  return render(<DocxStatusBar {...props} />);
}

describe("DocxStatusBar", () => {
  it("mirrors page, counts, language and zoom from its props", () => {
    const page: DocxStatusPage = { current: 2, total: 5 };
    const counts: DocxStatusCounts = { words: 12, characters: 64, charactersWithoutSpaces: 55 };
    renderBar({ page, counts, language: "vi-VN", zoom: 125 });
    expect(screen.getByRole("group", { name: "Document status" })).toBeInTheDocument();
    expect(screen.getByTestId("docx-status-page")).toHaveTextContent("Page 2 / 5");
    expect(screen.getByTestId("docx-status-words")).toHaveTextContent("Words: 12");
    expect(screen.getByTestId("docx-status-characters")).toHaveTextContent("Characters: 64");
    expect(screen.getByTestId("docx-status-characters-no-spaces")).toHaveTextContent("No spaces: 55");
    expect(screen.getByTestId("docx-status-language")).toHaveTextContent("Language: vi");
    expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("Zoom: 125%");
  });

  it("renders the unknown mark for every missing field", () => {
    renderBar({});
    expect(screen.getByTestId("docx-status-bar")).toHaveAttribute("aria-live", "off");
    for (const testId of [
      "docx-status-page",
      "docx-status-words",
      "docx-status-characters",
      "docx-status-characters-no-spaces",
      "docx-status-language",
      "docx-status-zoom",
    ]) {
      expect(screen.getByTestId(testId)).toHaveTextContent("—");
    }
  });

  it("derives the counts from a live editor when no counts are supplied", () => {
    const editor = new Editor({
      extensions: docxExtensions(),
      content: { type: "doc", content: [{ type: "docParagraph", content: [{ type: "text", text: "Xin chào UniWork" }] }] },
    });
    try {
      renderBar({ editor, page: { current: 1, total: 1 }, zoom: 100 });
      expect(screen.getByTestId("docx-status-words")).toHaveTextContent("Words: 3");
      expect(screen.getByTestId("docx-status-characters")).toHaveTextContent("Characters: 16");
      expect(screen.getByTestId("docx-status-characters-no-spaces")).toHaveTextContent("No spaces: 14");
      expect(screen.getByTestId("docx-status-page")).toHaveTextContent("Page 1 / 1");
      expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("Zoom: 100%");
    } finally {
      editor.destroy();
    }
  });

  it("renders a partial page position without inventing the missing side", () => {
    renderBar({ page: { current: 3 } });
    expect(screen.getByTestId("docx-status-page")).toHaveTextContent("Page 3 / —");
  });

  it("keeps every readout in a narrow container", () => {
    renderBar({ className: "w-24", page: { current: 1, total: 9 }, counts: { words: 1234 } });
    expect(screen.getByTestId("docx-status-bar")).toBeInTheDocument();
    expect(screen.getByTestId("docx-status-words")).toHaveTextContent("Words: 1234");
    expect(screen.getByTestId("docx-status-language")).toHaveTextContent("Language: —");
  });

  it("uses the primary subtag of a language tag and rejects blank ones", () => {
    expect(documentLanguageLabel("vi-VN")).toBe("vi");
    expect(documentLanguageLabel("EN_us")).toBe("en");
    expect(documentLanguageLabel("")).toBeNull();
    expect(documentLanguageLabel(null)).toBeNull();
    renderBar({ language: "fr-CA" });
    expect(screen.getByTestId("docx-status-language")).toHaveTextContent("Language: fr");
  });
});

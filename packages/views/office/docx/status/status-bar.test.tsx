import { Editor } from "@tiptap/core";
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
    expect(screen.getByTestId("docx-status-characters-no-spaces")).toHaveTextContent("Characters (no spaces): 55");
    expect(screen.getByTestId("docx-status-language")).toHaveTextContent("Language: vi");
    expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("125%");
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
    ]) {
      expect(screen.getByTestId(testId)).toHaveTextContent("—");
    }
    expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("–");
    expect(screen.getByTestId("docx-status-zoom")).not.toHaveTextContent("%");
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
      expect(screen.getByTestId("docx-status-characters-no-spaces")).toHaveTextContent("Characters (no spaces): 14");
      expect(screen.getByTestId("docx-status-page")).toHaveTextContent("Page 1 / 1");
      expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("100%");
    } finally {
      editor.destroy();
    }
  });

  it("keeps zero counts as known values", () => {
    renderBar({ counts: { words: 0, characters: 0, charactersWithoutSpaces: 0 } });
    expect(screen.getByTestId("docx-status-words")).toHaveTextContent("Words: 0");
    expect(screen.getByTestId("docx-status-characters")).toHaveTextContent("Characters: 0");
    expect(screen.getByTestId("docx-status-characters-no-spaces")).toHaveTextContent("Characters (no spaces): 0");
  });

  it("renders the unknown mark for negative, fractional and non-finite counts", () => {
    renderBar({ counts: { words: -3, characters: 12.7, charactersWithoutSpaces: Number.NaN } });
    expect(screen.getByTestId("docx-status-words")).toHaveTextContent("Words: —");
    expect(screen.getByTestId("docx-status-characters")).toHaveTextContent("Characters: —");
    expect(screen.getByTestId("docx-status-characters-no-spaces")).toHaveTextContent("Characters (no spaces): —");
  });

  it.each([0, -50, 100.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "renders the unknown mark without a percent for zoom %s",
    (zoom) => {
      renderBar({ zoom });
      const zoomCell = screen.getByTestId("docx-status-zoom");
      expect(zoomCell).toHaveTextContent(/^–$/);
      expect(zoomCell).not.toHaveTextContent("%");
    },
  );

  it("splits the readouts into a left cluster and a right cluster with the selection (C10)", () => {
    renderBar({ page: { current: 1, total: 3 }, counts: { words: 12 }, language: "vi-VN", zoom: 100, selection: { from: 2, to: 7 } });
    const left = screen.getByTestId("docx-status-left");
    const right = screen.getByTestId("docx-status-right");
    expect(left).toContainElement(screen.getByTestId("docx-status-page"));
    expect(left).toContainElement(screen.getByTestId("docx-status-language"));
    expect(right).toContainElement(screen.getByTestId("docx-status-selection"));
    expect(right).toContainElement(screen.getByTestId("docx-status-zoom"));
    expect(screen.getByTestId("docx-status-selection")).toHaveTextContent("Selection 2\u20137");
    expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("100%");
  });

  it("renders the selection count beside the range (C10)", () => {
    renderBar({ selection: { from: 16, to: 28 } });
    expect(screen.getByTestId("docx-status-selection-count")).toHaveTextContent("12 characters");
    // the range readout the editor test pins stays on its own testid
    expect(screen.getByTestId("docx-status-selection")).toHaveTextContent("Selection 16\u201328");
  });

  it("renders the selection count under the vi locale", async () => {
    await setLocale("vi");
    renderBar({ selection: { from: 16, to: 28 } });
    expect(screen.getByTestId("docx-status-selection-count")).toHaveTextContent("12 k\u00fd t\u1ef1");
  });

  it("wires the zoom step buttons to the supplied controller actions (C10)", () => {
    const onZoomIn = vi.fn();
    const onZoomOut = vi.fn();
    renderBar({ zoom: 100, onZoomIn, onZoomOut });
    const control = screen.getByTestId("docx-status-zoom-control");
    expect(control).toContainElement(screen.getByTestId("docx-status-zoom"));
    fireEvent.click(screen.getByRole("button", { name: "Zoom out" }));
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(onZoomOut).toHaveBeenCalledTimes(1);
    expect(onZoomIn).toHaveBeenCalledTimes(1);
  });

  it("offers page-width and whole-page view buttons only when the wiring supplies them (T12)", () => {
    const onFitWidth = vi.fn();
    const onFitPage = vi.fn();
    const { unmount } = renderBar({ zoom: 100 });
    expect(screen.queryByRole("group", { name: "View" })).toBeNull();
    unmount();
    renderBar({ zoom: 100, onFitWidth, onFitPage });
    expect(screen.getByRole("group", { name: "View" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Fit to width" }));
    fireEvent.click(screen.getByRole("button", { name: "Fit to page" }));
    expect(onFitWidth).toHaveBeenCalledTimes(1);
    expect(onFitPage).toHaveBeenCalledTimes(1);
  });

  it("keeps the zoom step buttons inert when no controller is wired", () => {
    renderBar({ zoom: 100 });
    expect(screen.getByRole("button", { name: "Zoom out" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("button", { name: "Zoom in" })).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("100%");
  });

  it("renders through the shared status row with the help slot last (F9)", () => {
    renderBar({ zoom: 100, help: <button type="button">help-slot</button> });
    const row = document.querySelector("[data-office-status-bar]");
    expect(row).not.toBeNull();
    expect(row?.lastElementChild?.lastElementChild).toBe(screen.getByRole("button", { name: "help-slot" }));
  });

  it("hides the selection readout for a collapsed caret", () => {
    renderBar({ selection: { from: 4, to: 4 } });
    expect(screen.queryByTestId("docx-status-selection")).toBeNull();
    expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("–");
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

  it("uses a well-formed primary subtag of a language tag and rejects malformed ones", () => {
    expect(documentLanguageLabel("vi-VN")).toBe("vi");
    expect(documentLanguageLabel("EN_us")).toBe("en");
    expect(documentLanguageLabel("zh-Hant")).toBe("zh");
    expect(documentLanguageLabel("a-b")).toBeNull();
    expect(documentLanguageLabel("toolongsubtag-x")).toBeNull();
    expect(documentLanguageLabel("123-x")).toBeNull();
    expect(documentLanguageLabel("!!!")).toBeNull();
    expect(documentLanguageLabel("")).toBeNull();
    expect(documentLanguageLabel(null)).toBeNull();
    renderBar({ language: "fr-CA" });
    expect(screen.getByTestId("docx-status-language")).toHaveTextContent("Language: fr");
  });

  it("renders Vietnamese copy under the vi locale", async () => {
    await setLocale("vi");
    renderBar({ page: { current: 2, total: 5 }, counts: { words: 12, charactersWithoutSpaces: 55 }, language: "vi-VN", zoom: 100 });
    expect(screen.getByTestId("docx-status-page")).toHaveTextContent("Trang 2 / 5");
    expect(screen.getByTestId("docx-status-words")).toHaveTextContent("Từ: 12");
    expect(screen.getByTestId("docx-status-characters-no-spaces")).toHaveTextContent("Ký tự (không dấu cách): 55");
    expect(screen.getByTestId("docx-status-language")).toHaveTextContent("Ngôn ngữ: vi");
    expect(screen.getByTestId("docx-status-zoom")).toHaveTextContent("100%");
  });
});

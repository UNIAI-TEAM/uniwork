// UNI-924 A6: the View-area public surface is the one import path the wiring
// task uses — the zoom controller entry, the three components and the outline.
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  DocxNavigationPane,
  DocxRuler,
  DocxZoomControl,
  createDocxZoomController,
  docxOutlineFromDoc,
  docxZoomFactorOf,
  installDocxZoomStyles,
  scrollDocxHeadingIntoView,
} from "./index";

describe("DOCX view public surface", () => {
  it("exports the shared controller helpers", () => {
    expect(typeof createDocxZoomController).toBe("function");
    expect(typeof installDocxZoomStyles).toBe("function");
    expect(docxZoomFactorOf(null)).toBe(1);
    // UNI-957: no page-wide controller; each document scope builds its own.
    expect(createDocxZoomController()).not.toBe(createDocxZoomController());
    expect(typeof scrollDocxHeadingIntoView).toBe("function");
    expect(docxOutlineFromDoc(null)).toEqual([]);
  });

  it("renders the zoom control, ruler and navigation pane from the index", () => {
    const controller = createDocxZoomController();
    const { unmount } = render(
      <>
        <DocxZoomControl controller={controller} />
        <DocxRuler
          settings={{ pageWidth: 12240, pageHeight: 15840, marginTop: 1440, marginBottom: 1440, marginLeft: 1440, marginRight: 1440 }}
        />
        <DocxNavigationPane items={[]} />
      </>,
    );
    expect(screen.getByTestId("docx-zoom-control")).toBeInTheDocument();
    expect(screen.getByTestId("docx-ruler")).toBeInTheDocument();
    expect(screen.getByTestId("docx-navigation-pane")).toBeInTheDocument();
    unmount();
    controller.dispose();
  });
});

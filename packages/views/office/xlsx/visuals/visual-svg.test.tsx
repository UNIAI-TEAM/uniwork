import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { XlsxVisualChart, XlsxVisualChartType, XlsxVisualShapeType } from "@uniwork/office-engine/xlsx";
import { XlsxVisualChartSvg } from "./visual-chart-svg";
import { XlsxVisualShapeSvg } from "./visual-shape-svg";

function chart(chartType: XlsxVisualChartType, values: number[][], title = "", categories = ["A", "B", "C"]): XlsxVisualChart {
  return { chartType, title, series: values.map((v, i) => ({ name: `S${i}`, categories: categories.slice(0, v.length), values: v })) };
}

function renderChart(c: XlsxVisualChart) {
  return render(<XlsxVisualChartSvg chart={c} width={400} height={240} label="Chart label" />);
}

describe("XlsxVisualChartSvg", () => {
  it("renders column and bar charts with one bar per value", () => {
    for (const type of ["column", "bar"] as const) {
      const { unmount } = renderChart(chart(type, [[1, 2, 3], [3, 2, 1]]));
      expect(screen.getByRole("img", { name: "Chart label" })).toBeTruthy();
      expect(screen.getAllByTestId("xlsx-visual-bar")).toHaveLength(6);
      unmount();
    }
  });

  it("renders line and area points", () => {
    for (const type of ["line", "area"] as const) {
      const { unmount } = renderChart(chart(type, [[1, 2, 3]]));
      expect(screen.getAllByTestId("xlsx-visual-point")).toHaveLength(3);
      unmount();
    }
  });

  it("renders pie and doughnut slices with a legend entry per category", () => {
    for (const type of ["pie", "doughnut"] as const) {
      const { container, unmount } = renderChart(chart(type, [[1, 2, 3]]));
      expect(screen.getAllByTestId("xlsx-visual-slice")).toHaveLength(3);
      expect(screen.getByTestId("xlsx-visual-legend").querySelectorAll("rect")).toHaveLength(3);
      expect(container.querySelector("svg")?.getAttribute("role")).toBe("img");
      unmount();
    }
  });

  it("shows a legend only for two or more series and a title when set", () => {
    const one = renderChart(chart("column", [[1, 2, 3]], "Revenue"));
    expect(screen.queryByTestId("xlsx-visual-legend")).toBeNull();
    expect(screen.getByText("Revenue")).toBeTruthy();
    one.unmount();
    renderChart(chart("column", [[1, 2, 3], [3, 2, 1]]));
    expect(screen.getByTestId("xlsx-visual-legend")).toBeTruthy();
  });

  it("does not throw on negatives, zeros or empty categories", () => {
    for (const type of ["column", "bar", "line", "area", "pie", "doughnut"] as const) {
      for (const values of [[-1, -2, 3], [0, 0, 0], [5]]) {
        const { unmount } = renderChart(chart(type, [values], "", []));
        expect(screen.getByRole("img")).toBeTruthy();
        unmount();
      }
    }
    renderChart({ chartType: "column", title: "", series: [] });
  });

  it("truncates long category labels with an ellipsis", () => {
    renderChart(chart("column", [[1, 2, 3]], "", ["a-very-long-category-name", "B", "C"]));
    expect(document.body.textContent).toContain("…");
  });
});

describe("XlsxVisualShapeSvg", () => {
  const cases: [XlsxVisualShapeType, string][] = [
    ["rect", "rect"],
    ["roundRect", "rect"],
    ["ellipse", "ellipse"],
    ["triangle", "path"],
    ["rightArrow", "polygon"],
    ["leftArrow", "polygon"],
  ];

  it.each(cases)("draws %s with the data fill", (shapeType, tag) => {
    const { container } = render(<XlsxVisualShapeSvg shape={{ shapeType, fillColor: "#112233" }} width={120} height={60} />);
    const el = screen.getByTestId("xlsx-visual-shape");
    expect(el.tagName.toLowerCase()).toBe(tag);
    expect(el.getAttribute("style")).toContain("#112233");
    expect(container.querySelector("svg")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("falls back to the chart token and draws text and lines", () => {
    const { unmount } = render(<XlsxVisualShapeSvg shape={{ shapeType: "rect", text: "Hello" }} width={100} height={50} />);
    expect(screen.getByTestId("xlsx-visual-shape").getAttribute("style")).toContain("var(--chart-1)");
    expect(screen.getByText("Hello")).toBeTruthy();
    unmount();
    render(<XlsxVisualShapeSvg shape={{ shapeType: "line" }} width={100} height={50} />);
    expect(screen.getByTestId("xlsx-visual-shape").getAttribute("fill")).toBe("none");
  });
});

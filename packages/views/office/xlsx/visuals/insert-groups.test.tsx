import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLocale } from "@uniwork/core/i18n";
import enLocale from "@uniwork/core/i18n/locales/en.json";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XlsxChartsGroup } from "../toolbar/groups/charts-group";
import { XLSX_TOOLBAR_GROUPS } from "../toolbar/registry";
import { XlsxIllustrationsGroup } from "./illustrations-group";
import { XlsxVisualsContext, type XlsxVisualsCommands } from "./visuals-context";

function commands(overrides: Partial<XlsxVisualsCommands> = {}): XlsxVisualsCommands {
  return { available: true, canInsertChart: true, insertChart: vi.fn(), insertShape: vi.fn(), insertPicture: vi.fn(), ...overrides };
}

function withCommands(value: XlsxVisualsCommands | null, children: ReactNode) {
  return <XlsxVisualsContext.Provider value={value}>{children}</XlsxVisualsContext.Provider>;
}

function lookup(dictionary: unknown, key: string): unknown {
  return key.split(".").reduce<unknown>((node, part) => {
    if (!node || typeof node !== "object") return undefined;
    return (node as Record<string, unknown>)[part];
  }, dictionary);
}

function leafPaths(node: unknown, prefix = ""): string[] {
  if (node === null || typeof node !== "object") return [prefix];
  return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key));
}

beforeEach(async () => {
  await setLocale("en");
});

describe("without a visuals provider", () => {
  it("renders the chart, picture and shape controls unavailable and never opens a menu", () => {
    render(
      <>
        <XlsxChartsGroup />
        <XlsxIllustrationsGroup />
      </>,
    );
    const chart = screen.getByTestId("xlsx-visuals-chart-trigger");
    const shape = screen.getByTestId("xlsx-visuals-shape-trigger");
    expect(chart).toHaveAttribute("aria-disabled", "true");
    expect(shape).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByTestId("xlsx-visuals-picture")).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(chart);
    fireEvent.click(shape);
    expect(screen.queryByTestId("xlsx-visuals-chart-menu")).toBeNull();
    expect(screen.queryByTestId("xlsx-visuals-shape-menu")).toBeNull();
  });

  it("does not insert a picture while unavailable", () => {
    const value = commands({ available: false });
    render(withCommands(value, <XlsxIllustrationsGroup />));
    fireEvent.click(screen.getByTestId("xlsx-visuals-picture"));
    expect(value.insertPicture).not.toHaveBeenCalled();
  });
});

describe("with a visuals provider", () => {
  it("opens the chart menu with six types and inserts the chosen one", async () => {
    const value = commands();
    render(withCommands(value, <XlsxChartsGroup />));
    fireEvent.click(screen.getByTestId("xlsx-visuals-chart-trigger"));
    const menu = await screen.findByTestId("xlsx-visuals-chart-menu");
    for (const type of ["column", "bar", "line", "area", "pie", "doughnut"]) {
      expect(screen.getByTestId(`xlsx-visuals-chart-${type}`)).toBeInTheDocument();
    }
    expect(menu.querySelectorAll("button")).toHaveLength(6);
    fireEvent.click(screen.getByTestId("xlsx-visuals-chart-pie"));
    expect(value.insertChart).toHaveBeenCalledWith("pie");
  });

  it("keeps the chart trigger unavailable without a range, with the reason as its title", () => {
    render(withCommands(commands({ canInsertChart: false }), <XlsxChartsGroup />));
    const trigger = screen.getByTestId("xlsx-visuals-chart-trigger");
    expect(trigger).toHaveAttribute("aria-disabled", "true");
    expect(trigger).toHaveAttribute("title", enLocale.office.xlsx.visuals.chart.needsRange);
    fireEvent.click(trigger);
    expect(screen.queryByTestId("xlsx-visuals-chart-menu")).toBeNull();
  });

  it("inserts a picture from the Picture button", () => {
    const value = commands();
    render(withCommands(value, <XlsxIllustrationsGroup />));
    fireEvent.click(screen.getByTestId("xlsx-visuals-picture"));
    expect(value.insertPicture).toHaveBeenCalledTimes(1);
  });

  it("opens the shapes menu with seven entries and inserts the chosen shape", async () => {
    const value = commands();
    render(withCommands(value, <XlsxIllustrationsGroup />));
    fireEvent.click(screen.getByTestId("xlsx-visuals-shape-trigger"));
    const menu = await screen.findByTestId("xlsx-visuals-shape-menu");
    expect(menu.querySelectorAll("button")).toHaveLength(7);
    fireEvent.click(screen.getByTestId("xlsx-visuals-shape-rightArrow"));
    expect(value.insertShape).toHaveBeenCalledWith("rightArrow");
  });
});

describe("registry and copy", () => {
  it("registers Illustrations on the Insert tab before Charts, with copy in both locales", () => {
    const illustrations = XLSX_TOOLBAR_GROUPS.find((group) => group.id === "illustrations");
    const charts = XLSX_TOOLBAR_GROUPS.find((group) => group.id === "charts");
    expect(illustrations?.tab).toBe("insert");
    expect(charts?.tab).toBe("insert");
    expect(illustrations!.order).toBeLessThan(charts!.order);
    for (const locale of [enLocale, viLocale]) {
      expect(typeof lookup(locale, illustrations!.labelKey)).toBe("string");
    }
  });

  it("keeps the office.xlsx.visuals key set identical in en and vi", () => {
    const en = leafPaths(enLocale.office.xlsx.visuals).sort();
    const vi = leafPaths(viLocale.office.xlsx.visuals).sort();
    expect(en.length).toBeGreaterThan(0);
    expect(vi).toEqual(en);
  });
});

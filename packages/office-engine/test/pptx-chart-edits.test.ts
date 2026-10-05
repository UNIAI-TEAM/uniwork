// B3e chart-edit builder tests (UNI-927) — pins the two vendored registry ops
// (file guard), the exact op objects (px -> EMU rect, data/style fields), and
// every refusal class the contract names.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildChartOps,
  CHART_KINDS,
  EMU_PER_PX_96,
  type ChartEdit,
  type OpenedPptxLike,
} from "../src/pptx";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..", "..", "..");
const PPTX_OPS = join(REPO, "packages", "office-upstream", "upstream", "packages", "pptx-ops", "src", "ops");
const CHART_INSERT = join(
  REPO,
  "packages",
  "office-upstream",
  "upstream",
  "packages",
  "pptx-engine",
  "src",
  "chart-insert.ts",
);

/** Deck whose width is 960px at 96 DPI, so scale-1 px -> EMU is *9525. */
const opened = (): OpenedPptxLike => ({
  deck: {
    size: { cx: 9144000, cy: 5143500 },
    slides: [
      { id: "s_1", elements: [{ id: "chart1", type: "chart" }, { id: "t1", type: "text" }] },
      { id: "s_2", elements: [{ id: "chart2", type: "chart" }] },
    ],
  },
});

type AddEdit = Extract<ChartEdit, { op: "add_chart" }>;

const ADD: AddEdit = {
  op: "add_chart",
  slideIndex: 0,
  kind: "bar",
  xPx: 100,
  yPx: 70,
  wPx: 600,
  hPx: 360,
  categories: ["Q1", "Q2", "Q3"],
  series: [{ name: "North", values: [10, 20, 30] }],
};

/** Runtime-junk helper: the builder must refuse anything the union type forbids. */
const addEdit = (over: Record<string, unknown>): ChartEdit => ({ ...ADD, ...over }) as unknown as ChartEdit;

const errCode = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return String((error as { code?: string }).code ?? error);
  }
  return "";
};

describe("chart edits — vendored guard", () => {
  it("binds only op names registered in the vendored pptx-ops sources", () => {
    const insertOps = readFileSync(join(PPTX_OPS, "insert-ops.ts"), "utf8");
    const tableOps = readFileSync(join(PPTX_OPS, "table-ops.ts"), "utf8");
    expect(insertOps).toContain("name: 'addChart'");
    expect(tableOps).toContain("name: 'setChart'");
  });

  it("pins CHART_KINDS to the engine's NewChartKind union", () => {
    const source = readFileSync(CHART_INSERT, "utf8");
    const start = source.indexOf("export type NewChartKind =");
    expect(start).toBeGreaterThan(-1);
    const union = source.slice(start, source.indexOf("\n\n", start));
    const kinds = [...union.matchAll(/'([A-Za-z0-9]+)'/g)].map((match) => match[1]);
    expect(kinds).toEqual([...CHART_KINDS]);
  });
});

describe("buildChartOps — add_chart", () => {
  it("emits the exact addChart op: px rect -> EMU, data + style verbatim", () => {
    expect(
      buildChartOps(opened(), 960, {
        ...ADD,
        series: [
          { name: "North", values: [10, 20, 30] },
          { name: "South", values: [15, 25, 35] },
        ],
        barDir: "bar",
        title: "Revenue",
        colorScheme: ["#1F6FEB", "#D29922"],
        holeSizePct: 60,
      }),
    ).toEqual([
      {
        op: "addChart",
        target: { slide: 0 },
        kind: "bar",
        offset: {
          x: 100 * EMU_PER_PX_96,
          y: 70 * EMU_PER_PX_96,
          cx: 600 * EMU_PER_PX_96,
          cy: 360 * EMU_PER_PX_96,
        },
        categories: ["Q1", "Q2", "Q3"],
        series: [
          { name: "North", values: [10, 20, 30] },
          { name: "South", values: [15, 25, 35] },
        ],
        barDir: "bar",
        title: "Revenue",
        colorScheme: ["#1F6FEB", "#D29922"],
        holeSizePct: 60,
      },
    ]);
  });

  it("omits optional fields and scales the rect by fitWidthPx", () => {
    const op = buildChartOps(opened(), 1920, ADD)[0]!;
    expect(Object.keys(op).sort()).toEqual(["categories", "kind", "offset", "op", "series", "target"]);
    expect(op.offset).toEqual({
      x: Math.round((100 / 2) * EMU_PER_PX_96),
      y: Math.round((70 / 2) * EMU_PER_PX_96),
      cx: Math.round((600 / 2) * EMU_PER_PX_96),
      cy: Math.round((360 / 2) * EMU_PER_PX_96),
    });
  });

  it("clamps a zero-size rect to a 1 EMU extent like addElement/addImage", () => {
    const op = buildChartOps(opened(), 960, { ...ADD, xPx: 0, yPx: 0, wPx: 0, hPx: 0 })[0]!;
    expect(op.offset).toEqual({ x: 0, y: 0, cx: 1, cy: 1 });
  });

  it("accepts #RRGGBBAA colors like the vendored requireHexColor", () => {
    const op = buildChartOps(opened(), 960, { ...ADD, colorScheme: ["#1F6FEB", "#11223344"] })[0]!;
    expect(op.colorScheme).toEqual(["#1F6FEB", "#11223344"]);
  });

  it("refuses every invalid input class with its stable code", () => {
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ slideIndex: 9 })))).toBe("no_slide");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ kind: undefined })))).toBe("bad_chart_kind");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ kind: "donut" })))).toBe("bad_chart_kind");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ barDir: "diagonal" })))).toBe("bad_chart_kind");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ xPx: -1 })))).toBe("bad_chart_rect");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ yPx: Number.NaN })))).toBe("bad_chart_rect");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ wPx: Number.POSITIVE_INFINITY })))).toBe("bad_chart_rect");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ hPx: "40" })))).toBe("bad_chart_rect");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ categories: [] })))).toBe("bad_chart_data");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ categories: ["Q1", 2] })))).toBe("bad_chart_data");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ series: [] })))).toBe("bad_chart_data");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ series: [null] })))).toBe("bad_chart_data");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ series: [{ name: 1, values: [1] }] })))).toBe(
      "bad_chart_data",
    );
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ series: [{ name: "N", values: "x" }] })))).toBe(
      "bad_chart_data",
    );
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ series: [{ name: "N", values: [1, Number.NaN] }] })))).toBe(
      "bad_chart_data",
    );
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ holeSizePct: Number.NaN })))).toBe("bad_chart_data");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ holeSizePct: Number.POSITIVE_INFINITY })))).toBe(
      "bad_chart_data",
    );
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ title: 7 })))).toBe("bad_chart_data");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ colorScheme: [] })))).toBe("bad_chart_color");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ colorScheme: ["red"] })))).toBe("bad_chart_color");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ colorScheme: ["#12345"] })))).toBe("bad_chart_color");
    expect(errCode(() => buildChartOps(opened(), 960, addEdit({ colorScheme: [42] })))).toBe("bad_chart_color");
  });

  it("refuses before conversion when the deck or fit width cannot scale", () => {
    expect(errCode(() => buildChartOps(opened(), 0, ADD))).toBe("bad_fit_width");
    expect(errCode(() => buildChartOps({ deck: { slides: [] } }, 960, ADD))).toBe("no_slide");
    expect(errCode(() => buildChartOps({ deck: { slides: [{ elements: [] }] } }, 960, ADD))).toBe("deck_size_missing");
  });
});

describe("buildChartOps — set_chart", () => {
  it("emits the exact setChart op with the structural patch", () => {
    const patch: Record<string, unknown> = {
      kind: "line",
      barDir: "col",
      categories: ["A", "B"],
      series: [{ name: "S", values: [1, 2] }],
      title: "T",
      colorScheme: ["#1F6FEB"],
      legendPos: "b",
      dataLabels: true,
      gridlines: false,
      catAxisTitle: "X",
      valAxisTitle: "Y",
      gapWidthPct: 120,
      holeSizePct: 40,
      switchRowCol: false,
      pointColors: { 0: { 1: "#D29922", 2: null } },
    };
    expect(buildChartOps(opened(), 960, { op: "set_chart", slideIndex: 0, elementId: "chart1", patch })).toEqual([
      { op: "setChart", target: { slide: 0, el: "chart1" }, patch },
    ]);
  });

  it("passes an empty patch and any fit width through — no geometry conversion runs", () => {
    expect(buildChartOps(opened(), 0, { op: "set_chart", slideIndex: 1, elementId: "chart2", patch: {} })).toEqual([
      { op: "setChart", target: { slide: 1, el: "chart2" }, patch: {} },
    ]);
  });

  it("refuses every invalid target or patch with its stable code", () => {
    expect(errCode(() => buildChartOps(opened(), 960, { op: "set_chart", slideIndex: 9, elementId: "chart1", patch: {} }))).toBe(
      "no_slide",
    );
    expect(errCode(() => buildChartOps(opened(), 960, { op: "set_chart", slideIndex: 0, elementId: "nope", patch: {} }))).toBe(
      "no_element",
    );
    expect(errCode(() => buildChartOps(opened(), 960, { op: "set_chart", slideIndex: 0, elementId: "t1", patch: {} }))).toBe(
      "no_element",
    );
    const nullPatch = { op: "set_chart", slideIndex: 0, elementId: "chart1", patch: null } as unknown as ChartEdit;
    expect(errCode(() => buildChartOps(opened(), 960, nullPatch))).toBe("bad_chart_patch");
    const arrayPatch = { op: "set_chart", slideIndex: 0, elementId: "chart1", patch: [] } as unknown as ChartEdit;
    expect(errCode(() => buildChartOps(opened(), 960, arrayPatch))).toBe("bad_chart_patch");
  });
});

// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMermaidInitializeOptions, getMermaidThemeVariables } from "./mermaid-diagram";

// Resolved from the views package root, which vitest always uses as the working
// directory, so the assertions read the palette the app actually ships.
const tokensCss = readFileSync(resolve(process.cwd(), "../ui/styles/tokens.css"), "utf8");

/** Declarations inside one top-level `selector { ... }` block. */
function block(selector: string): string {
  const start = tokensCss.search(
    new RegExp(`^${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{`, "m"),
  );
  if (start === -1) return "";
  const open = tokensCss.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < tokensCss.length; index++) {
    if (tokensCss[index] === "{") depth++;
    else if (tokensCss[index] === "}") {
      depth--;
      if (depth === 0) return tokensCss.slice(open + 1, index);
    }
  }
  return "";
}

/** `#rrggbb` token -> the `rgb(r, g, b)` string the canvas round-trip emits. */
function tokenRgb(theme: ":root" | ".dark", token: string): string {
  const match = block(theme).match(new RegExp(`^\\s*${token}\\s*:\\s*(#[0-9a-f]{6});`, "m"));
  if (!match?.[1]) throw new Error(`${token} not found in ${theme}`);
  const value = Number.parseInt(match[1].slice(1), 16);
  return `rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`;
}

type ThemeVariable = keyof ReturnType<typeof getMermaidThemeVariables>;

/** Every Mermaid variable the diagram must resolve, and the token behind it. */
const MAPPING: Array<[ThemeVariable, string]> = [
  ["primaryColor", "--muted"],
  ["primaryBorderColor", "--primary"],
  ["primaryTextColor", "--foreground"],
  ["lineColor", "--muted-foreground"],
  ["background", "--background"],
  ["mainBkg", "--card"],
  ["clusterBkg", "--muted"],
  ["clusterBorder", "--border"],
  ["edgeLabelBackground", "--card"],
  ["secondaryColor", "--muted"],
  ["tertiaryColor", "--muted"],
  ["nodeBorder", "--border"],
  ["textColor", "--foreground"],
];

const realGetComputedStyle = window.getComputedStyle.bind(window);

interface FakeCanvasContext {
  fillStyle: string;
  fillRect: () => void;
  getImageData: () => ImageData;
}

/**
 * jsdom resolves neither `var()` in a computed colour nor canvas pixels, so the
 * real cascade is simulated: a probe carrying `color: var(--x)` answers with the
 * token's current theme value, and the canvas reads back the bytes it was given.
 */
function installThemeResolution(): void {
  vi.spyOn(window, "getComputedStyle").mockImplementation((element: Element) => {
    const variable = element
      .getAttribute("style")
      ?.match(/color:\s*var\((--[a-z-]+)\)/)?.[1];
    if (!variable) return realGetComputedStyle(element);
    const theme = document.documentElement.classList.contains("dark") ? ".dark" : ":root";
    return { color: tokenRgb(theme, variable) } as CSSStyleDeclaration;
  });

  const context: FakeCanvasContext = {
    fillStyle: "#000",
    fillRect: () => undefined,
    getImageData(this: FakeCanvasContext) {
      const [red, green, blue] = (/^rgba?\(([^)]+)\)$/.exec(this.fillStyle)?.[1] ?? "0,0,0")
        .split(",")
        .map(Number);
      return { data: [red, green, blue, 255] } as unknown as ImageData;
    },
  };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(
    context as unknown as CanvasRenderingContext2D,
  );
}

describe("getMermaidThemeVariables", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove("dark");
    document.body.replaceChildren();
  });

  it("resolves every themed surface from tokens, so dark differs from light", () => {
    installThemeResolution();
    const host = document.createElement("div");
    document.body.appendChild(host);

    const light = getMermaidThemeVariables(host);
    document.documentElement.classList.add("dark");
    const dark = getMermaidThemeVariables(host);

    for (const [variable, token] of MAPPING) {
      expect(light[variable], `light ${variable}`).toBe(tokenRgb(":root", token));
      expect(dark[variable], `dark ${variable}`).toBe(tokenRgb(".dark", token));
    }

    // The regression: Mermaid's base theme paints these surfaces from its own
    // light defaults, which is the white box a dark document used to show.
    const surfaces: readonly ThemeVariable[] = [
      "background",
      "mainBkg",
      "clusterBkg",
      "edgeLabelBackground",
      "secondaryColor",
      "tertiaryColor",
    ];
    for (const surface of surfaces) {
      expect(dark[surface], `${surface} must not keep its light value`).not.toBe(
        light[surface],
      );
    }

    // A leftover var() would resolve to nothing inside the sandboxed iframe.
    for (const value of Object.values(dark)) {
      expect(value).not.toContain("var(");
    }
  });
});

/**
 * Mermaid paints a second layer of surfaces from its own `darkMode` flag, which
 * defaults to false: git-graph commit highlights (`fill:#ffffff`), the
 * `rowOdd`/`rowEven` pair and the `surface*` ramp. `themeVariables` alone does
 * not reach them, so a dark host still got a light default — the reported white
 * box survived commit a9b71454 for exactly this reason. These render the real
 * SVG through the component's own config and read what Mermaid actually wrote.
 */
describe("getMermaidInitializeOptions", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.documentElement.classList.remove("dark");
    document.body.replaceChildren();
  });

  /**
   * Mermaid's own light defaults, as concrete colour values. Matching the value
   * (not the bare word) keeps `lightgrey` — the commit-id ink — out of the net;
   * light ink on a dark ground is correct, a light *surface* is not.
   */
  const LIGHT_DEFAULT = /#f4f4f4|#ffffff|#fff\b|rgb\(\s*255\s*,\s*255\s*,\s*255\s*\)|\bwhite\b/i;

  async function renderWith(chart: string, dark: boolean): Promise<string> {
    installThemeResolution();
    document.documentElement.classList.toggle("dark", dark);
    const host = document.createElement("div");
    document.body.appendChild(host);
    const mermaid = (await import("mermaid")).default;
    // jsdom has no SVG layout; Mermaid measures text through these two.
    const svgProto = SVGElement.prototype as unknown as {
      getBBox: () => DOMRect;
      getComputedTextLength: () => number;
    };
    svgProto.getBBox = () => ({ x: 0, y: 0, width: 200, height: 100 }) as DOMRect;
    svgProto.getComputedTextLength = () => 40;

    mermaid.initialize(getMermaidInitializeOptions(host));
    const { svg } = await mermaid.render(`regression-${dark ? "dark" : "light"}`, chart);
    return svg;
  }

  const GIT_GRAPH = "gitGraph\n  commit\n  branch dev\n  commit\n";
  const SEQUENCE =
    "sequenceDiagram\n  participant A\n  participant B\n  A->>B: Hi\n  Note over A,B: n\n  alt y\n    B->>A: ok\n  end\n";

  it("carries no light default when the host is dark", async () => {
    // gitGraph is the family the token map could not reach: its commit
    // highlights come from `darkMode`, not from a theme variable. On the
    // pre-fix tip this renders `.commit-highlight0 { fill:#ffffff }`.
    const gitGraph = await renderWith(GIT_GRAPH, true);

    expect(gitGraph).not.toMatch(LIGHT_DEFAULT);
    expect(gitGraph).not.toContain("commit-highlight0{stroke:#ffffff;fill:#ffffff;}");

    // A second family, so the guard is not git-graph-specific.
    const sequence = await renderWith(SEQUENCE, true);
    expect(sequence).not.toMatch(LIGHT_DEFAULT);
  }, 60_000);

  it("keeps light mode's own rendering (light is not regressed)", async () => {
    const light = await renderWith(GIT_GRAPH, false);

    // Light still paints the commit highlight it always did — the value is
    // derived from the light `mainBkg`, and it is a real SVG.
    expect(light).toContain("regression-light");
    expect(light).toMatch(/\.commit-highlight0\{stroke:rgb\([^)]*\);fill:rgb\([^)]*\);\}/);
  }, 60_000);

  it("renders a different SVG for dark than for light", async () => {
    const light = await renderWith(GIT_GRAPH, false);
    const dark = await renderWith(GIT_GRAPH, true);

    expect(dark).not.toBe(light);
  }, 60_000);
});

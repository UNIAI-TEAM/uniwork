// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getMermaidThemeVariables } from "./mermaid-diagram";

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

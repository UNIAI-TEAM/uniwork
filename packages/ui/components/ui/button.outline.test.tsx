import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "./button";

const tokens = readFileSync(resolve(process.cwd(), "styles/tokens.css"), "utf8");

function tokenIn(selector: string, name: string): string {
  const start = tokens.search(new RegExp(`^${selector.replace(".", "\\.")}\\s*\\{`, "m"));
  const body = tokens.slice(start, tokens.indexOf("\n}", start));
  return body.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`))![1]!;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * An outline button is identified by its boundary; `--border` (the hairline
 * between panels) sits at ~1.2:1 on the page in light mode, which renders the
 * Google and "resend" buttons as bare text. The outline variant draws its
 * edge with `--input`, the same token as text inputs, in both modes — and
 * that token has to clear WCAG 1.4.11's 3:1 against the page.
 */
describe("outline button boundary", () => {
  it("uses the input border token, not the panel hairline", () => {
    render(<Button variant="outline">Tiếp tục với Google</Button>);
    const cls = screen.getByRole("button").className;
    expect(cls).toContain("border-input");
    expect(cls).not.toMatch(/(^|\s)border-border(\s|$)/);
  });

  it.each([":root", ".dark"])("--input clears 3:1 on --background in %s", (scope) => {
    expect(contrast(tokenIn(scope, "input"), tokenIn(scope, "background"))).toBeGreaterThanOrEqual(3);
  });
});

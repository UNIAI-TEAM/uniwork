import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Tailwind silently drops a utility whose colour has no `--color-*` token, so
// `text-destructive-foreground` compiles to nothing and the text falls back to
// whatever it inherits. Signal colours are where that has bitten (there is no
// `-foreground` for them: use `-soft-foreground` on a soft fill, `text-on-solid`
// on a `-solid` fill), so every signal utility must name a real token.
const ROOT = join(__dirname);
const TOKENS = readFileSync(join(__dirname, "../ui/styles/tokens.css"), "utf8");
const COLORS = new Set([...TOKENS.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));
const SIGNAL_UTILITY =
  /(?<![\w-])(?:[a-z-]+:)*!?(?:text|bg|border|ring|fill|stroke|outline|decoration|from|via|to)-((?:destructive|success|warning|info)(?:-[a-z]+)*)(?:\/\d+)?(?![\w-])/g;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules" || name === "coverage-tmp") return [];
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("signal colour utilities", () => {
  it("only name colours that exist as tokens", () => {
    const unknown: string[] = [];
    for (const file of sources(ROOT)) {
      for (const m of readFileSync(file, "utf8").matchAll(SIGNAL_UTILITY)) {
        if (!COLORS.has(m[1])) unknown.push(`${relative(ROOT, file)}: ${m[0]}`);
      }
    }
    expect(unknown).toEqual([]);
  });
});

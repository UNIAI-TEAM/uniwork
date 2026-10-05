import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

const rendererDir = fileURLToPath(new URL(".", import.meta.url));
const stylesPath = join(rendererDir, "styles.css");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

it("defines the token font variables and imports the bundled Inter", () => {
  const css = readFileSync(stylesPath, "utf8");
  expect(css).toMatch(/@import "@fontsource-variable\/inter\/wght\.css"/);
  expect(css).toMatch(/--font-inter:\s*"Inter Variable"/);
  expect(css).toMatch(/--font-plus-jakarta:\s*"Plus Jakarta Sans Variable"/);
  expect(css).toMatch(/--font-jetbrains-mono:\s*"JetBrains Mono Variable"/);
});

it("references no remote font host anywhere in the renderer", () => {
  for (const file of [...sourceFiles(rendererDir), join(rendererDir, "index.html")]) {
    if (file.endsWith("fonts.test.ts")) continue;
    expect(readFileSync(file, "utf8"), file).not.toMatch(/fonts\.(googleapis|gstatic)\.com/);
  }
});

it("compiles to local woff2 files with the vietnamese subset and no node_modules urls", async () => {
  const scriptUrl = new URL("../scripts/compile-styles.mjs", import.meta.url).href;
  const { compileRendererStyles } = (await import(/* @vite-ignore */ scriptUrl)) as {
    compileRendererStyles: (entry: string, out: string) => Promise<string>;
  };
  const out = mkdtempSync(join(tmpdir(), "uw-fonts-"));
  try {
    const css = await compileRendererStyles(stylesPath, join(out, "styles.css"));
    expect(css).not.toMatch(/url\([^)]*(?:node_modules|https?:)/);
    for (const family of ["inter", "plus-jakarta-sans", "jetbrains-mono"]) {
      expect(css).toContain(`url(./fonts/${family}-vietnamese-wght-normal.woff2)`);
      expect(existsSync(join(out, "fonts", `${family}-vietnamese-wght-normal.woff2`))).toBe(true);
    }
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 60_000);

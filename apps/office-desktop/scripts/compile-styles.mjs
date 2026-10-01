import { writeFile, readFile } from "node:fs/promises";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

/**
 * Compiles the renderer's Tailwind v4 entry (tokens + base + utilities) to
 * plain CSS the packaged app serves as a static file. No build step in the
 * Electron pipeline runs PostCSS already, so this is a small, explicit pass
 * instead of folding Tailwind into the esbuild bundle step.
 */
export async function compileRendererStyles(entryPath, outPath) {
  const css = await readFile(entryPath, "utf8");
  const result = await postcss([tailwind()]).process(css, { from: entryPath, to: outPath });
  await writeFile(outPath, result.css);
  return result.css;
}

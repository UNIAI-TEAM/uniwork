import { copyFile, mkdir, writeFile, readFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

// Same subsets the web host loads through next/font (apps/web/app/layout.tsx).
const KEPT_SUBSETS = /-(?:latin|latin-ext|vietnamese)-wght-(?:normal|italic)\.woff2$/;

/**
 * Compiles the renderer's Tailwind v4 entry (tokens + base + utilities) to
 * plain CSS the packaged app serves as a static file. No build step in the
 * Electron pipeline runs PostCSS already, so this is a small, explicit pass
 * instead of folding Tailwind into the esbuild bundle step.
 *
 * The Fontsource @font-face rules come out pointing into node_modules, which
 * the packaged asar does not carry. Keep only the web subsets, copy those
 * woff2 files beside the stylesheet (./fonts/) and rewrite the urls, so the
 * renderer loads fonts with zero network requests.
 */
export async function compileRendererStyles(entryPath, outPath) {
  const css = await readFile(entryPath, "utf8");
  const result = await postcss([tailwind()]).process(css, { from: entryPath, to: outPath });
  const fontsDir = join(dirname(outPath), "fonts");
  const copies = new Map();
  const out = result.css.replace(/@font-face\s*\{[^}]*\}/g, (block) => {
    const match = /url\(([^)]*files\/[^)]+\.woff2)\)/.exec(block);
    if (!match) return block;
    const file = basename(match[1]);
    if (!KEPT_SUBSETS.test(file)) return "";
    copies.set(file, resolve(dirname(entryPath), match[1]));
    return block.replace(match[1], `./fonts/${file}`);
  });
  await mkdir(fontsDir, { recursive: true });
  for (const [file, source] of copies) await copyFile(source, join(fontsDir, file));
  await writeFile(outPath, out);
  return out;
}

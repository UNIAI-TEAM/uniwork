/**
 * Measure per-glyph advances for the wordmark.
 *
 * Kerning lives in Inter's GPOS table; rather than reimplement OpenType shaping
 * here, the browser shapes the string and reports where each glyph landed.
 * build-wordmark.py then draws the real outlines at those positions.
 *
 * Usage: node scripts/brand/measure-text.mjs <font.ttf> <text> <tracking-em>
 */
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const pwt = require.resolve("@playwright/test", { paths: [path.join(root, "e2e")] });
const pw = require(require.resolve("playwright-core", { paths: [path.dirname(pwt)] }));

const [fontPath, text, tracking] = process.argv.slice(2);
const font = readFileSync(fontPath).toString("base64");
const SIZE = 1000;

const browser = await pw.chromium.launch();
const page = await browser.newPage();
await page.setContent(`<style>
@font-face{font-family:M;src:url(data:font/ttf;base64,${font}) format('truetype')}
body{margin:0}
#t{font-family:M;font-size:${SIZE}px;letter-spacing:${tracking}em;white-space:pre;display:inline-block}
</style><span id="t">${text}</span>`);
await page.evaluate(() => document.fonts.ready);
const out = await page.evaluate(() => {
  const node = document.getElementById("t").firstChild;
  const range = document.createRange();
  const x = [];
  for (let i = 0; i < node.length; i++) {
    range.setStart(node, i);
    range.setEnd(node, i + 1);
    x.push(range.getBoundingClientRect().left);
  }
  range.selectNodeContents(node);
  return { x, left: range.getBoundingClientRect().left };
});
await browser.close();
console.log(JSON.stringify({ ...out, size: SIZE }));

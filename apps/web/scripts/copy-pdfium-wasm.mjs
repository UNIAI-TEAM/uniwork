// Copies the pdfium wasm binary next to the web app's public assets so the
// browser PDF renderer can fetch it from /office/pdfium.wasm. The output is
// git-ignored; dev/build run this first. The version is the catalog pin the
// office-engine browser loader is built against.
import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const source = require.resolve("@embedpdf/pdfium/pdfium.wasm");
const target = resolve(here, "..", "public", "office", "pdfium.wasm");

mkdirSync(dirname(target), { recursive: true });
if (!existsSync(target) || statSync(target).size !== statSync(source).size) {
  copyFileSync(source, target);
}

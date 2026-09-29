import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { mkdir, copyFile, writeFile, rm } from "node:fs/promises";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireRoot = createRequire(join(app, "..", "..", "package.json"));
const esbuild = requireRoot("esbuild");
const dist = join(app, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = { bundle: true, format: "esm", target: "es2022", sourcemap: true, legalComments: "none", logLevel: "warning", outExtension: { ".js": ".mjs" } };
await esbuild.build({ ...common, platform: "node", entryPoints: { "main/index": join(app, "main/index.ts"), "preload/index": join(app, "preload/index.ts") }, outdir: dist });
await esbuild.build({ ...common, platform: "browser", entryPoints: { "renderer/index": join(app, "renderer/index.ts") }, outdir: dist });
await copyFile(join(app, "renderer/index.html"), join(dist, "renderer/index.html"));
await writeFile(join(dist, "BUILD-METADATA.json"), JSON.stringify({ appId: "com.uniwork.office", mode: "unsigned-dev", electron: { sandbox: true, contextIsolation: true, nodeIntegration: false }, renderer: "dist/renderer/index.mjs" }, null, 2) + "\n");
process.stdout.write("office-desktop: unsigned development bundle written to dist/\n");

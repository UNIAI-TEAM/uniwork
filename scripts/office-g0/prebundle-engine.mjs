// Bundle the engine package the DOC-003 lab host cannot import directly.
//
// Why this exists: the prepared GenOffice source is run through its own tsx so
// the lab never copies engine code into this repository. tsx resolves directory
// imports and extensionless relative imports, but it does not understand the
// "?raw" markdown imports inside @genoffice/pptx-ops
// (prompts/ops/*.md?raw), and --import module hooks are not invoked by tsx at
// all. esbuild can be told how to load those files, so pptx-ops is bundled to a
// temp ESM file that the engine host then imports like any other module.
//
// Run with the prepared source tree's own node, from any cwd:
//   node <spike>/scripts/office-g0/prebundle-engine.mjs --source <dir> --out <file>
import { mkdir, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const index = args.indexOf("--" + name);
  return index === -1 ? fallback : args[index + 1];
};

const SOURCE = resolve(argOf("source", "."));
const OUT = resolve(argOf("out", "lab/engine/pptx-ops.mjs"));

// esbuild lives in the prepared source tree, not in this spike, so it is
// required through the source's own package.json instead of this file's.
const sourceRequire = createRequire(resolve(SOURCE, "package.json"));
const { build } = sourceRequire("esbuild");

// Resolve a "file?raw" import to its file and inline it as a JS string literal.
const rawPlugin = {
  name: "raw-text",
  setup(b) {
    b.onResolve({ filter: /[?]raw$/ }, (a) => ({
      path: resolve(a.resolveDir, a.path.replace(/[?]raw$/, "")),
      namespace: "raw-text",
    }));
    b.onLoad({ filter: /.*/, namespace: "raw-text" }, (a) => ({
      contents: "export default " + JSON.stringify(readFileSync(a.path, "utf8")),
      loader: "js",
    }));
  },
};

const result = await build({
  absWorkingDir: SOURCE,
  entryPoints: ["packages/pptx-ops/src/index.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  write: false,
  logLevel: "warning",
  plugins: [rawPlugin],
  external: ["electron"],
});

const output = result.outputFiles[0];
await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, output.contents);
console.log(
  JSON.stringify({
    out: OUT,
    bytes: output.contents.length,
    hasRunTxn: output.text.includes("runTxn"),
  }),
);

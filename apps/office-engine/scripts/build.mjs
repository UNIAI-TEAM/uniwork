// Bundle the engine service for its container: dist/main.mjs (service),
// dist/worker.mjs (worker process entry) and dist/worker-run.mjs (handler
// thread). esbuild comes from the workspace root, like the office replay
// drivers, so this app does not pin a second copy.
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const requireRoot = createRequire(join(app, "..", "..", "package.json"));
const esbuild = requireRoot("esbuild");

const common = { bundle: true, platform: "node", format: "esm", target: "node22", sourcemap: false, legalComments: "none", logLevel: "warning" };
await esbuild.build({
  ...common,
  entryPoints: { main: join(app, "src/main.ts"), worker: join(app, "src/worker/entry.ts"), "worker-run": join(app, "src/worker/run.ts") },
  outdir: join(app, "dist"),
  outExtension: { ".js": ".mjs" },
  // zod and friends are CommonJS-free, but a stray require() in a dependency
  // needs a real require in an ESM bundle.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
});
process.stdout.write("office-engine bundle written to dist/\n");

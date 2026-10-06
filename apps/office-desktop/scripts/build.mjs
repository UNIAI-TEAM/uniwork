import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { mkdir, copyFile, writeFile, rm, readFile } from "node:fs/promises";
import { dirname as pathDirname, join as pathJoin } from "node:path";
import { deriveBuildMetadata, readDeploymentProfileFromEnv, writeDeploymentProfile } from "./deployment-profile.mjs";
import { compileRendererStyles } from "./compile-styles.mjs";
import { missingGatewayError, resolveXlsxAssetSources, stageXlsxAssets } from "./xlsx-assets.mjs";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const identity = JSON.parse(await readFile(join(app, "identity.json"), "utf8"));
const packageJson = JSON.parse(await readFile(join(app, "package.json"), "utf8"));
const buildMetadata = deriveBuildMetadata(process.env, identity, packageJson.version);
const deploymentProfile = readDeploymentProfileFromEnv(process.env, identity, packageJson.version);
const requireRoot = createRequire(join(app, "..", "..", "package.json"));
const esbuild = requireRoot("esbuild");
const dist = join(app, "dist");
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

const common = { bundle: true, target: "es2022", sourcemap: true, legalComments: "none", logLevel: "warning", metafile: true, external: ["electron"] };
const buildMetafiles = [];
// The main process is an ES module (dist/main/index.mjs) but its graph pulls
// CommonJS dependencies (pngjs/jpeg-js/pdf-lib/pako through the PDF engine).
// esbuild inlines them and shims their `require` calls with a helper that
// throws "Dynamic require of \"...\" is not supported" under ESM, aborting
// Electron at load. The dependencies must stay bundled (the packaged asar
// rejects raw node_modules), so inject a real require for the Node builtins
// they reach for. The banner is emitted verbatim ahead of the helpers, so the
// shim sees a defined `require`.
const mainRequireBanner = 'import { createRequire as __uniworkCreateRequire } from "node:module";\nconst require = __uniworkCreateRequire(import.meta.url);';
buildMetafiles.push((await esbuild.build({ ...common, format: "esm", outExtension: { ".js": ".mjs" }, platform: "node", banner: { js: mainRequireBanner }, entryPoints: { "main/index": join(app, "electron-main.ts") }, outdir: dist })).metafile);
// Electron sandboxed preloads run as plain CommonJS. Keep this artifact
// loadable under the pinned sandbox contract; native wiring may still inject
// Electron through the adapter seam without exposing it to the renderer.
buildMetafiles.push((await esbuild.build({ ...common, format: "cjs", outExtension: { ".js": ".cjs" }, platform: "node", entryPoints: { "preload/index": join(app, "preload/index.ts") }, outdir: dist })).metafile);
// The Markdown view imports KaTeX CSS, whose @font-face lists woff2, woff and ttf.
// Electron reads woff2, so inline that one and drop the other two from the bundle.
const katexFontLoaders = { ".woff2": "dataurl", ".woff": "empty", ".ttf": "empty" };
buildMetafiles.push((await esbuild.build({ ...common, loader: katexFontLoaders, format: "esm", outExtension: { ".js": ".mjs" }, platform: "browser", jsx: "automatic", entryPoints: { "renderer/index": join(app, "renderer/index.tsx") }, outdir: dist })).metafile);
await copyFile(join(app, "renderer/index.html"), join(dist, "renderer/index.html"));
await mkdir(join(dist, "renderer"), { recursive: true });
await compileRendererStyles(join(app, "renderer/styles.css"), join(dist, "renderer/styles.css"));
if (deploymentProfile) await writeDeploymentProfile(join(dist, "deployment-profile.json"), deploymentProfile);
await writeFile(join(dist, "build-identity.json"), JSON.stringify({ ...buildMetadata.identity, channel: buildMetadata.channel, version: buildMetadata.version, buildId: buildMetadata.buildId }, null, 2) + "\n");
const inputs = {};
for (const metafile of buildMetafiles) for (const [input, details] of Object.entries(metafile.inputs ?? {})) inputs[input] = details;
await writeFile(join(dist, ".build-metafile.json"), JSON.stringify({ inputs }, null, 2) + "\n");

const officeEngine = createRequire(join(app, "..", "..", "packages", "office-engine", "package.json"));
const pdfAssets = join(dist, "main", "pdf-assets");
await mkdir(join(pdfAssets, "fonts"), { recursive: true });
await copyFile(officeEngine.resolve("@embedpdf/pdfium/pdfium.wasm"), join(pdfAssets, "pdfium.wasm"));
await copyFile(pathJoin(pathDirname(officeEngine.resolve("harfbuzzjs")), "harfbuzz-subset.wasm"), join(pdfAssets, "harfbuzz-subset.wasm"));
for (const font of ["NotoSans-Regular.ttf", "NotoSans-Bold.ttf"]) {
  await copyFile(join(app, "..", "..", "packages", "office-engine", "assets", "fonts", font), join(pdfAssets, "fonts", font));
}
// The local .xlsx lane runs the bundled gateway in MAIN. package.mjs stages it
// for a packaged build; an unpackaged run (electron <app>) resolves the same
// dist/xlsx-assets dir, so stage it here too. The gateway comes from
// scripts/office/build-upstream.mjs (or OFFICE_DESKTOP_XLSX_ASSETS); a dev
// build without it still builds, says so, and every local .xlsx open answers
// the typed engine_incompatible failure instead of a fake engine.
const repositoryRoot = join(app, "..", "..");
const xlsxSources = resolveXlsxAssetSources({ repositoryRoot });
if (xlsxSources.gateway) {
  const staged = await stageXlsxAssets({ repositoryRoot, distDirectory: dist });
  // Without the sidecar a local .xlsx opens and formula-free saves work, but
  // every save of a workbook with formulas is refused (xlsx_recalc_unavailable).
  if (!staged.sidecar) process.stderr.write("office-desktop: no xlsx recalc sidecar staged - saving a local .xlsx that contains formulas will be refused. Build it with node scripts/office/build-upstream.mjs --with-native, or point OFFICE_DESKTOP_XLSX_ASSETS at a dir holding xlsx-gateway.mjs + the sidecar.\n");
}
else process.stderr.write(`office-desktop: local .xlsx open is unavailable in this build - ${missingGatewayError(xlsxSources).message}\n`);
await writeFile(join(dist, "BUILD-METADATA.json"), JSON.stringify({
  product: buildMetadata.identity.product,
  appId: buildMetadata.identity.appId,
  executable: buildMetadata.identity.executable,
  channel: buildMetadata.channel,
  buildId: buildMetadata.buildId,
  appVersion: buildMetadata.version,
  engineVersion: identity.engine.version,
  contractVersion: identity.engine.contractVersion,
  protocolVersion: identity.engine.protocolVersion,
  ...(deploymentProfile ? { deploymentId: deploymentProfile.deploymentId, apiOrigin: deploymentProfile.apiOrigin } : {}),
  mode: buildMetadata.buildId,
  electron: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  main: "dist/main/index.mjs",
  preload: "dist/preload/index.cjs",
  renderer: "dist/renderer/index.mjs",
}, null, 2) + "\n");
process.stdout.write("office-desktop: unsigned development bundle written to dist/\n");

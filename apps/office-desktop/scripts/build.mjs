import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";
import { mkdir, copyFile, writeFile, rm, readFile } from "node:fs/promises";
import { deriveBuildMetadata, readDeploymentProfileFromEnv, writeDeploymentProfile } from "./deployment-profile.mjs";
import { compileRendererStyles } from "./compile-styles.mjs";

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
buildMetafiles.push((await esbuild.build({ ...common, format: "esm", outExtension: { ".js": ".mjs" }, platform: "node", entryPoints: { "main/index": join(app, "electron-main.ts") }, outdir: dist })).metafile);
// Electron sandboxed preloads run as plain CommonJS. Keep this artifact
// loadable under the pinned sandbox contract; native wiring may still inject
// Electron through the adapter seam without exposing it to the renderer.
buildMetafiles.push((await esbuild.build({ ...common, format: "cjs", outExtension: { ".js": ".cjs" }, platform: "node", entryPoints: { "preload/index": join(app, "preload/index.ts") }, outdir: dist })).metafile);
buildMetafiles.push((await esbuild.build({ ...common, format: "esm", outExtension: { ".js": ".mjs" }, platform: "browser", jsx: "automatic", entryPoints: { "renderer/index": join(app, "renderer/index.tsx") }, outdir: dist })).metafile);
await copyFile(join(app, "renderer/index.html"), join(dist, "renderer/index.html"));
await mkdir(join(dist, "renderer"), { recursive: true });
await compileRendererStyles(join(app, "renderer/styles.css"), join(dist, "renderer/styles.css"));
if (deploymentProfile) await writeDeploymentProfile(join(dist, "deployment-profile.json"), deploymentProfile);
await writeFile(join(dist, "build-identity.json"), JSON.stringify({ ...buildMetadata.identity, channel: buildMetadata.channel, version: buildMetadata.version, buildId: buildMetadata.buildId }, null, 2) + "\n");
const inputs = {};
for (const metafile of buildMetafiles) for (const [input, details] of Object.entries(metafile.inputs ?? {})) inputs[input] = details;
await writeFile(join(dist, ".build-metafile.json"), JSON.stringify({ inputs }, null, 2) + "\n");
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

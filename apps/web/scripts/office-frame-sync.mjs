/* global console, process */
// Syncs the genoffice web builds (the fork's dist-web/<module>/<version>/) into
// public/office-frame/<module>/<version>/ so Next serves each same-origin at
// /office-frame/<module>/<version>/index.html (UNI-1013 docs; UNI-1014/1015/1016
// pdf, markdown, html, slides, sheets).
//
//   node scripts/office-frame-sync.mjs --from <dir|.tar.gz|https-url>   install the pinned docs build
//   node scripts/office-frame-sync.mjs --module pdf --from <...>        install the pinned build of one module
//   node scripts/office-frame-sync.mjs --all --from <...>               every pinned module (with --pin: every module in the source)
//   node scripts/office-frame-sync.mjs --from <...> --pin               install it and (re)write the pin
//   (add --allow-dirty for a local run of a build made from an uncommitted fork checkout; never commit that pin)
//   node scripts/office-frame-sync.mjs --check [--module m | --all]     verify what is installed
//   node scripts/office-frame-sync.mjs --ensure                         build hook, every pinned module: check,
//                                                                       else sync from OFFICE_FRAME_SOURCE, else warn
//
// A source is a dist-web root holding <module>/ directories (or a tarball of
// one), one module's directory holding its version (the docs-only layout of
// UNI-1013), or a version directory; see locateModuleBundle.
//
// The bundles themselves are NOT checked in (17 MiB each, regenerated per fork
// build; the repo's own precedent is the git-ignored pdfium wasm). What is
// checked in is platform/office-frame/<module>.pin.json: version, fork gitSha,
// the sha256 of the build's manifest.json (which digests every file), the
// response headers and the policies of the documents that have their own (the
// html module's preview.html).
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMatchesPin, assertModule, buildPin, OFFICE_MODULES } from "../platform/office-frame/frame-bundle.mjs";
import { assertHeadersMatchPin, checkInstalled, install, loadBundle, locateModuleBundle, materialize } from "../platform/office-frame/frame-install.mjs";
import { pinPath, readPin } from "../platform/office-frame/frame-headers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const publicRoot = (module) => resolve(here, "..", "public", "office-frame", module);

/**
 * Installs each module from one materialized source. A module the source has
 * no build of is an error when it was asked for by name, a warning otherwise.
 */
async function sync({ source, modules, named, repin, allowDirty }) {
  const scratch = mkdtempSync(join(tmpdir(), "office-frame-"));
  try {
    const root = await materialize(source, scratch);
    for (const module of modules) {
      const dir = locateModuleBundle(root, module);
      if (!dir) {
        if (named) throw new Error(`${source} has no ${module} build`);
        console.warn(`office-frame: ${source} has no ${module} build; ${module} is not installed`);
        continue;
      }
      const bundle = loadBundle(dir, { allowDirty });
      if (bundle.manifest.module !== module) throw new Error(`${dir} is a ${bundle.manifest.module} build, not ${module}`);
      const pin = readPin(pinPath(module));
      if (repin) {
        writeFileSync(pinPath(module), `${JSON.stringify(buildPin(bundle.manifest, bundle.manifestSha256, bundle.headers, bundle.documents), null, 2)}\n`);
        console.log(`office-frame: pinned ${module} ${bundle.manifest.version} (${bundle.manifest.gitSha.slice(0, 12)})`);
      } else if (!pin) {
        throw new Error(`no ${module}.pin.json; run with --pin once to record the build you intend to serve`);
      } else {
        assertMatchesPin(pin, bundle.manifest, bundle.manifestSha256);
        assertHeadersMatchPin(pin, bundle.headers, bundle.documents);
      }
      const target = install(dir, bundle, publicRoot(module));
      console.log(`office-frame: ${module} ${bundle.manifest.files.length} files verified, installed at ${target}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { mode: "sync", source: process.env.OFFICE_FRAME_SOURCE, module: undefined, all: false, repin: false, allowDirty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") args.source = argv[++i];
    else if (arg === "--module") args.module = assertModule(argv[++i]);
    else if (arg === "--all") args.all = true;
    else if (arg === "--pin") args.repin = true;
    else if (arg === "--allow-dirty") args.allowDirty = true;
    else if (arg === "--check") args.mode = "check";
    else if (arg === "--ensure") args.mode = "ensure";
    else throw new Error(`unknown argument ${arg}`);
  }
  if (args.all && args.module) throw new Error("--module and --all exclude each other");
  return args;
}

/** --module m names one; --all (and --ensure without --module) means every pinned module, or every module when pinning. */
function selectModules(args) {
  if (args.module) return { modules: [args.module], named: true };
  if (args.all || args.mode === "ensure") {
    return { modules: OFFICE_MODULES.filter((m) => args.repin || readPin(pinPath(m))), named: false };
  }
  return { modules: ["docs"], named: true };
}

/** Is the pinned build of module installed and verified? Logs why not. */
function ensureInstalled(module) {
  const pin = readPin(pinPath(module));
  try {
    if (checkInstalled(pin, publicRoot(module))) {
      console.log(`office-frame: ${module} ${pin.version} already installed`);
      return true;
    }
  } catch (error) {
    console.warn(`office-frame: the installed ${module} ${pin.version} does not verify (${error.message})`);
  }
  return false;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { modules, named } = selectModules(args);
  if (args.mode === "check") {
    if (modules.length === 0) throw new Error("no module is pinned");
    for (const module of modules) {
      const pin = readPin(pinPath(module));
      if (!pin) throw new Error(`no ${module}.pin.json`);
      if (!checkInstalled(pin, publicRoot(module))) throw new Error(`office-frame ${module} ${pin.version} is not installed; run office-frame:sync`);
      console.log(`office-frame: ${module} ${pin.version} installed and verified`);
    }
    return;
  }
  if (args.mode === "ensure") {
    if (modules.length === 0) return console.log("office-frame: no pin, nothing to serve (every office_*_web flag stays off)");
    const missing = modules.filter((module) => !ensureInstalled(module));
    if (missing.length === 0) return;
    if (!args.source) {
      // A checkout without access to the fork still builds. next.config.mjs offers a frame only
      // when its pinned bundle is installed and verifies, so with no bundle the G3 editor stays the
      // editor for every organization, whatever the module's flag says.
      return console.warn(`office-frame: ${missing.join(", ")} pinned but not installed and OFFICE_FRAME_SOURCE is unset; those frames are not offered (G3 editor stays)`);
    }
    return sync({ ...args, modules: missing, named });
  }
  if (!args.source) throw new Error("--from <dir|.tar.gz|https-url> or OFFICE_FRAME_SOURCE is required");
  if (modules.length === 0) throw new Error("no module is pinned; name one with --module, or pin with --all --pin");
  await sync({ ...args, modules, named });
}

main().catch((error) => {
  console.error(`office-frame: ${error.message}`);
  process.exit(1);
});

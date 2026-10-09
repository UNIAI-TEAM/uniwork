/* global console, process */
// Syncs the genoffice Docs web build (the fork's dist-web/docs/<version>/) into
// public/office-frame/docs/<version>/ so Next serves it same-origin at
// /office-frame/docs/<version>/index.html (UNI-1013).
//
//   node scripts/office-frame-sync.mjs --from <dir|.tar.gz|https-url>   install the pinned build
//   node scripts/office-frame-sync.mjs --from <...> --pin               install it and (re)write the pin
//   (add --allow-dirty for a local run of a build made from an uncommitted fork checkout; never commit that pin)
//   node scripts/office-frame-sync.mjs --check                          verify what is installed
//   node scripts/office-frame-sync.mjs --ensure                         build hook: check, else sync
//                                                                       from OFFICE_FRAME_SOURCE, else warn
//
// The bundle itself is NOT checked in (17 MiB, regenerated per fork build; the
// repo's own precedent is the git-ignored pdfium wasm). What is checked in is
// platform/office-frame/docs.pin.json: version, fork gitSha, the sha256 of the
// build's manifest.json (which digests every file) and the response headers.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertMatchesPin, buildPin } from "../platform/office-frame/frame-bundle.mjs";
import { assertHeadersMatchPin, checkInstalled, install, loadBundle, materialize } from "../platform/office-frame/frame-install.mjs";
import { PIN_PATH, readPin } from "../platform/office-frame/frame-headers.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const PUBLIC_ROOT = resolve(here, "..", "public", "office-frame", "docs");

async function sync({ source, repin, allowDirty }) {
  const scratch = mkdtempSync(join(tmpdir(), "office-frame-"));
  try {
    const dir = await materialize(source, scratch);
    const bundle = loadBundle(dir, { allowDirty });
    const pin = readPin();
    if (repin) {
      writeFileSync(PIN_PATH, `${JSON.stringify(buildPin(bundle.manifest, bundle.manifestSha256, bundle.headers), null, 2)}\n`);
      console.log(`office-frame: pinned ${bundle.manifest.version} (${bundle.manifest.gitSha.slice(0, 12)})`);
    } else if (!pin) {
      throw new Error("no docs.pin.json; run with --pin once to record the build you intend to serve");
    } else {
      assertMatchesPin(pin, bundle.manifest, bundle.manifestSha256);
      assertHeadersMatchPin(pin, bundle.headers);
    }
    const target = install(dir, bundle, PUBLIC_ROOT);
    console.log(`office-frame: ${bundle.manifest.files.length} files verified, installed at ${target}`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { mode: "sync", source: process.env.OFFICE_FRAME_SOURCE, repin: false, allowDirty: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--from") args.source = argv[++i];
    else if (arg === "--pin") args.repin = true;
    else if (arg === "--allow-dirty") args.allowDirty = true;
    else if (arg === "--check") args.mode = "check";
    else if (arg === "--ensure") args.mode = "ensure";
    else throw new Error(`unknown argument ${arg}`);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const pin = readPin();
  if (args.mode === "check") {
    if (!pin) throw new Error("no docs.pin.json");
    if (!checkInstalled(pin, PUBLIC_ROOT)) throw new Error(`office-frame ${pin.version} is not installed; run office-frame:sync`);
    console.log(`office-frame: ${pin.version} installed and verified`);
    return;
  }
  if (args.mode === "ensure") {
    if (!pin) return console.log("office-frame: no pin, nothing to serve (office_docs_web stays off)");
    let installed = false;
    try {
      installed = checkInstalled(pin, PUBLIC_ROOT);
    } catch (error) {
      console.warn(`office-frame: the installed ${pin.version} does not verify (${error.message})`);
    }
    if (installed) return console.log(`office-frame: ${pin.version} already installed`);
    if (!args.source) {
      // A checkout without access to the fork still builds. next.config.mjs offers the frame only
      // when the pinned bundle is installed and verifies, so with no bundle the G3 editor stays the
      // editor for every organization, whatever office_docs_web says.
      return console.warn(`office-frame: ${pin.version} is pinned but not installed and OFFICE_FRAME_SOURCE is unset; the Docs frame is not offered (G3 editor stays)`);
    }
  }
  if (!args.source) throw new Error("--from <dir|.tar.gz|https-url> or OFFICE_FRAME_SOURCE is required");
  await sync(args);
}

main().catch((error) => {
  console.error(`office-frame: ${error.message}`);
  process.exit(1);
});

#!/usr/bin/env node
// UNI-684 / G2-01a - Office boundary checker.
//
// Enforces the three boundary rules the lane owns:
//   1. Browser isolation: the browser-facing surface of @uniwork/office-engine
//      (src/index.ts, src/shared/**, src/browser/**) and all of
//      @uniwork/office-contracts must not resolve Node, Electron, native or
//      canvas - directly OR transitively through relative imports.
//   2. No /ee anywhere in the office tree: upstream /ee is separately licensed
//      enterprise material and must never enter the source package
//      (docs/office/g0/source-manifest.json).
//   3. Licence attribution: when packages/office-upstream exists it must carry
//      a non-empty LICENSE and NOTICE.
//
// Node 22 built-ins only. Exit 0 only when the tree is clean.
//
//   node scripts/office/check-boundaries.mjs            # check the real tree
//   node --test scripts/office/check-boundaries.test.mjs

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Import specifiers a browser-facing file must never resolve. */
export const FORBIDDEN_BROWSER_SPECIFIERS = [
  /^node:/,
  /^electron(\/|$)/,
  /^canvas(\/|$)/,
  /^@napi-rs\//,
  /\.node$/,
];

/** Bare specifiers a browser-facing file may legitimately import. Anything
 * else bare is a violation (a browser entry cannot reach a workspace package
 * that itself pulls Node). */
export const BROWSER_SAFE_PACKAGES = new Set([
  "zod",
  "zustand",
  // UNI-931 ribbon collapse preference: persist/createJSONStorage are plain JS
  // and write through the StorageAdapter, never a Node API.
  "zustand/middleware",
  // G3 web host: the platform shell is browser code and consumes the shared
  // core/view/ui contracts. Their package exports keep Node-only code out of
  // this graph; the checker treats the package boundary as the seam.
  "react",
  "react-dom/client",
  "react-i18next",
  "@uniwork/core/office",
  // G4-06a: the desktop renderer mounts React through packages/ui and the
  // shared host-agnostic i18n singleton. Same package-boundary argument as
  // the entries above - their exports contain no Node/Electron import.
  "@uniwork/core/i18n",
  "@uniwork/ui/brand",
  "@uniwork/ui/components/ui/button",
  "@uniwork/ui/components/ui/avatar",
  "@uniwork/ui/components/ui/input",
  "@uniwork/ui/components/ui/skeleton",
  "@uniwork/ui/components/ui/radio-group",
  // UNI-917 desktop tab strip/library header
  "@uniwork/views/layout/collection-page",
  "@uniwork/ui/components/ui/dropdown-menu",
  "@uniwork/ui/components/ui/popover",
  "@uniwork/views/office/office-shell",
  "@uniwork/views/office/editor-slot",
  "@uniwork/views/office/docx",
  "@uniwork/views/documents/document-type-icon",
  "lucide-react",
  "@uniwork/ui/lib/utils",
  "@uniwork/core/api/endpoints/office",
  "@uniwork/core/api/endpoints/config",
  "@uniwork/core/api/endpoints/office-desktop",
  "@uniwork/core/office/save-coordinator",
  "@uniwork/core/auth",
  "@uniwork/core/api/endpoints/office",
  // G3-05b: the XLSX adapter binds browser-safe HTTP document endpoints and
  // the view component; these exports contain contracts/fetch wrappers only.
  "@uniwork/core/api/endpoints/documents",
  "@uniwork/core/api/endpoints/documents-versions",
  "@uniwork/views/office/xlsx",
  "@uniwork/core/drafts/cleanup-registry",
  "@uniwork/core/types/document",
  "@uniwork/ui/components/ui/alert",
  "@uniwork/views/navigation",
  "@uniwork/views/office",
  "@uniwork/views/office/leave-dialog",
  "@uniwork/office-contracts",
  "@uniwork/office-engine",
  // G3-04c: the DOCX host is browser code. `next/dynamic` is the framework's
  // client-only dynamic import (ssr:false keeps the DOCX graph out of the
  // server build); the views subpath mirrors the xlsx entry above;
  // docs-renderer-editor is the generated browser ESM artifact whose build
  // rejects any non-browser external.
  "next/dynamic",
  "@uniwork/views/office/docx",
  "@uniwork/office-upstream/docs-renderer-editor",
]);
const BROWSER_SAFE_ENGINE_SUBPATHS = new Set(["browser", "markdown", "html", "assets", "xlsx", "docx"]);

/** Browser-scope roots, relative to the repo root. Every file under these
 * roots (plus relative-import closure) must stay free of forbidden specifiers. */
export const BROWSER_SCOPE_ROOTS = [
  "packages/office-contracts/src",
  "packages/office-engine/src/index.ts",
  "packages/office-engine/src/shared",
  "packages/office-engine/src/browser",
  "packages/office-engine/src/markdown",
  "packages/office-engine/src/html",
  "packages/office-engine/src/assets",
  // G2-04: the browser-safe half of the xlsx lane. Its native sidecar lives
  // under src/node and stays out of this scope by construction.
  "packages/office-engine/src/xlsx",
  "packages/core/office",
  "apps/web/platform/office",
];

/** Directories the /ee and licence checks scan. */
export const OFFICE_TREE_ROOTS = [
  "packages/office-contracts",
  "packages/office-engine",
  "packages/office-upstream",
  "apps/office-engine",
  "apps/web/platform/office",
  "apps/office-desktop",
];

/** Desktop renderer/preload are a second host boundary. Renderer code is
 * browser code and may not resolve Node/Electron/main; preload may use the
 * Electron bridge but must not import the main graph. Both graphs are chased
 * transitively so a helper cannot smuggle privileged code across the seam. */
export const DESKTOP_RENDERER_ROOTS = ["apps/office-desktop/renderer"];
export const DESKTOP_PRELOAD_ROOTS = ["apps/office-desktop/preload"];

const SOURCE_EXT = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".jsx"]);

/** Test files are never part of a shipped entry point: they legitimately
 * import vitest and node: builtins (hash fixtures, temp dirs). The boundary
 * rule applies to what a browser bundle would resolve, so test files are out
 * of the browser scope - but still scanned for /ee specifiers. */
function isTestFile(relOrAbsPath) {
  return /\.(test|spec)\.[a-z]+$/.test(relOrAbsPath) || /(^|[\\/])(test|tests|__tests__)[\\/]/.test(relOrAbsPath);
}

function* walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "dist") continue;
      yield* walk(full);
    } else {
      yield full;
    }
  }
}

/** Extract import/export/require specifier strings from a source file.
 * Literal template imports (`import(\`./x\`)` without `${}`) are extracted too;
 * computed specifiers are not - they are reported by unverifiableModuleCalls. */
export function extractImportSpecifiers(source) {
  const specifiers = [];
  const patterns = [
    /(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g,
    /import\s*\(\s*["'`]([^"'`$]+)["'`]\s*\)/g,
    /require\s*\(\s*["'`]([^"'`$]+)["'`]\s*\)/g,
    // A literal worker URL is a module specifier: it loads a second graph the
    // scan must walk. importScripts is the worker-side equivalent.
    /\bnew\s+Worker\s*\(\s*["'`]([^"'`$]+)["'`]/g,
    /\bimportScripts\s*\(\s*["'`]([^"'`$]+)["'`]\s*\)/g,
  ];
  for (const re of patterns) {
    for (const match of source.matchAll(re)) specifiers.push(match[1]);
  }
  return specifiers;
}

/**
 * Module-resolution constructs a static checker cannot verify: a computed
 * import()/require() argument, a template specifier containing ${}, or
 * createRequire (which rebuilds CJS resolution anywhere). In browser scope
 * each is a violation - the surface must stay statically enumerable.
 */
export function unverifiableModuleCalls(source) {
  const hits = [];
  const patterns = [
    [/\bimport\s*\(\s*(?!["'`])/g, "computed import()"],
    [/\bimport\s*\(\s*`[^`]*\$\{/g, "template import() with ${}"],
    [/\brequire\s*\(\s*(?!["'`])/g, "computed require()"],
    [/\brequire\s*\(\s*`[^`]*\$\{/g, "template require() with ${}"],
    [/\bcreateRequire\b/g, "createRequire"],
    [/\bprocess\.env\b/g, "process.env"],
    [/\bglobalThis\.process\b/g, "globalThis.process"],
    // Code and module access the import graph cannot enumerate. Literal
    // Worker/importScripts specifiers are extracted as imports instead.
    [/\beval\s*\(/g, "eval()"],
    [/\bnew\s+Function\s*\(/g, "new Function()"],
    [/\bimportScripts\s*\(\s*(?!["'`])/g, "computed importScripts()"],
    [/\bnew\s+Worker\s*\(\s*(?!["'`])/g, "computed new Worker()"],
    [/\bimport\.meta\.resolve\b/g, "import.meta.resolve"],
  ];
  for (const [re, label] of patterns) {
    for (const match of source.matchAll(re)) hits.push(label + " " + JSON.stringify(match[0].trim()));
  }
  return hits;
}

/** Resolve a relative specifier to a file that exists. */
function resolveRelative(fromFile, specifier) {
  const base = path.resolve(path.dirname(fromFile), specifier);
  const candidates = [base, base + ".ts", base + ".tsx", base + ".mts", base + ".js", base + ".mjs",
    path.join(base, "index.ts"), path.join(base, "index.tsx"), path.join(base, "index.mjs")];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return path.resolve(candidate);
  }
  return null;
}

function isForbiddenSpecifier(specifier) {
  return FORBIDDEN_BROWSER_SPECIFIERS.some((re) => re.test(specifier));
}

function isBrowserSafePackage(specifier) {
  if (BROWSER_SAFE_PACKAGES.has(specifier)) return true;
  const prefix = "@uniwork/office-engine/";
  if (!specifier.startsWith(prefix)) return false;
  const subpath = specifier.slice(prefix.length);
  return BROWSER_SAFE_ENGINE_SUBPATHS.has(subpath);
}

/** A path segment exactly "ee" = the separately licensed upstream enterprise
 * tree. Also catch specifiers that name /ee paths inside the office tree. */
function hasEnterpriseSegment(relPath) {
  return relPath.split(/[\\/]/).includes("ee");
}

/**
 * Check a tree. `scope` = { browserRoots: abs paths, officeRoots: abs paths,
 * requireUpstreamLicence: bool }. Returns { ok, violations: [{rule,file,detail}] }.
 */
export function checkBoundaries(root, { requireUpstreamLicence = null } = {}) {
  const violations = [];
  const report = (rule, file, detail) => violations.push({ rule, file, detail });

  // --- 1. Browser isolation -------------------------------------------------
  const browserRoots = BROWSER_SCOPE_ROOTS.map((r) => path.join(root, r));
  const seen = new Set();
  const queue = [];
  for (const entry of browserRoots) {
    if (!fs.existsSync(entry)) continue;
    if (fs.statSync(entry).isFile()) {
      if (!isTestFile(entry)) queue.push(entry);
    } else {
      for (const f of walk(entry)) {
        if (!isTestFile(f)) queue.push(f);
      }
    }
  }

  while (queue.length) {
    const file = queue.shift();
    const normalized = path.resolve(file);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    if (!SOURCE_EXT.has(path.extname(normalized))) continue;

    const source = fs.readFileSync(normalized, "utf8");
    for (const hit of unverifiableModuleCalls(source)) {
      report("browser_isolation", normalized, `unverifiable module access: ${hit}`);
    }
    for (const specifier of extractImportSpecifiers(source)) {
      if (isForbiddenSpecifier(specifier)) {
        report("browser_isolation", normalized, `resolves forbidden specifier ${JSON.stringify(specifier)}`);
        continue;
      }
      if (specifier === "../node" || specifier === "../node/index" || /(^|\/)\.\.[\\/]node[\\/]/.test(specifier)
        || specifier.endsWith("/node") || /(^|\/)node$/.test(path.dirname(specifier))) {
        report("browser_isolation", normalized, `imports the node entry ${JSON.stringify(specifier)}`);
        continue;
      }
      if (specifier.startsWith("./") || specifier.startsWith("../")) {
        const resolved = resolveRelative(normalized, specifier);
        if (resolved === null) {
          report("browser_isolation", normalized, `unresolvable specifier ${JSON.stringify(specifier)}`);
        } else if (!seen.has(resolved) && !isTestFile(resolved)) {
          // Transitive: only local resolution inside the repo can smuggle
          // Node facilities; chase it.
          if (resolved.startsWith(root + path.sep)) queue.push(resolved);
          else report("browser_isolation", normalized, `resolves outside the checkout: ${resolved}`);
        }
      } else if (!isBrowserSafePackage(specifier)) {
        report("browser_isolation", normalized, `resolves non-browser-safe specifier ${JSON.stringify(specifier)}`);
      }
    }
  }

  function scanDesktopGraph(relRoots, rule, { renderer = false } = {}) {
    const roots = relRoots.map((rel) => path.join(root, rel));
    const graphQueue = [];
    const graphSeen = new Set();
    for (const entry of roots) {
      if (!fs.existsSync(entry)) continue;
      if (fs.statSync(entry).isFile()) graphQueue.push(entry);
      else for (const f of walk(entry)) if (!isTestFile(f)) graphQueue.push(f);
    }
    while (graphQueue.length) {
      const file = path.resolve(graphQueue.shift());
      if (graphSeen.has(file) || !SOURCE_EXT.has(path.extname(file))) continue;
      graphSeen.add(file);
      const source = fs.readFileSync(file, "utf8");
      for (const hit of unverifiableModuleCalls(source)) report(rule, path.relative(root, file), `unverifiable module access: ${hit}`);
      for (const specifier of extractImportSpecifiers(source)) {
        const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
        if (!isRelative) {
          // Renderer/preload graphs use the same browser-safe package allowlist.
          // A preload may import Electron's bridge primitives, but neither
          // graph may smuggle Node built-ins or the desktop engine entry.
          const preloadElectron = !renderer && specifier === "electron";
          if (isForbiddenSpecifier(specifier) && !preloadElectron) {
            report(rule, path.relative(root, file), `${renderer ? "renderer" : "preload"} resolves forbidden privileged specifier ${JSON.stringify(specifier)}`);
            continue;
          }
          if (!preloadElectron && !isBrowserSafePackage(specifier)) {
            report(rule, path.relative(root, file), `${renderer ? "renderer" : "preload"} resolves non-browser-safe specifier ${JSON.stringify(specifier)}`);
            continue;
          }
        }
        if (specifier.startsWith("./") || specifier.startsWith("../")) {
          const resolved = resolveRelative(file, specifier);
          if (!resolved) { report(rule, path.relative(root, file), `unresolvable specifier ${JSON.stringify(specifier)}`); continue; }
          const relResolved = path.relative(root, resolved).replaceAll("\\", "/");
          if (relResolved.startsWith("apps/office-desktop/main/") || relResolved.startsWith("apps/office-desktop/preload/")) {
            if (renderer || relResolved.startsWith("apps/office-desktop/main/")) report(rule, path.relative(root, file), `imports privileged desktop graph ${JSON.stringify(specifier)}`);
          }
          if (!graphSeen.has(resolved) && resolved.startsWith(root + path.sep)) graphQueue.push(resolved);
        }
      }
    }
  }

  scanDesktopGraph(DESKTOP_RENDERER_ROOTS, "desktop_renderer_isolation", { renderer: true });
  scanDesktopGraph(DESKTOP_PRELOAD_ROOTS, "desktop_preload_isolation");

  // --- 2. No /ee ------------------------------------------------------------
  for (const rel of OFFICE_TREE_ROOTS) {
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const relPath = path.relative(root, file);
      if (hasEnterpriseSegment(relPath)) {
        report("ee_path", relPath, "a path segment named 'ee' must never enter the office tree");
      }
      if (SOURCE_EXT.has(path.extname(file))) {
        const source = fs.readFileSync(file, "utf8");
        for (const specifier of extractImportSpecifiers(source)) {
          if (specifier.split("/").includes("ee") || specifier.split("\\").includes("ee")) {
            report("ee_path", relPath, `imports an /ee path ${JSON.stringify(specifier)}`);
          }
        }
      }
    }
  }

  // --- 2b. Exports map -------------------------------------------------------
  // The package.json exports map is itself a boundary artifact: repointing "."
  // or "./browser" at node/desktop code would bypass the import scan entirely,
  // so every leaf target behind the browser surface is checked to exist and to
  // stay out of node/desktop directories.
  const enginePkg = "packages/office-engine";
  const enginePkgJson = path.join(root, enginePkg, "package.json");
  if (fs.existsSync(enginePkgJson)) {
    const exportsMap = (JSON.parse(fs.readFileSync(enginePkgJson, "utf8")).exports) || {};
    const leaves = (v) => typeof v === "string" ? [v]
      : v && typeof v === "object" ? Object.values(v).flatMap(leaves) : [];
    // Runtime condition keys route a different target per runtime - behind the
    // browser surface keys the contract is "same browser-safe code everywhere",
    // so a runtime branch must not exist there at all.
    const RUNTIME_CONDITION_KEYS = new Set(["node", "electron", "deno", "bun", "react-native"]);
    const conditionKeys = (v, acc) => {
      if (!v || typeof v !== "object") return;
      for (const k of Object.keys(v)) {
        if (!k.startsWith("./") && RUNTIME_CONDITION_KEYS.has(k)) acc.push(k);
        conditionKeys(v[k], acc);
      }
    };
    for (const key of [".", "./browser"]) {
      if (!(key in exportsMap)) {
        report("exports_map", `${enginePkg}/package.json`, `exports["${key}"] is missing - the browser surface must be declared`);
        continue;
      }
      const runtimeKeys = [];
      conditionKeys(exportsMap[key], runtimeKeys);
      for (const k of runtimeKeys) {
        report("exports_map", `${enginePkg}/package.json`,
          `exports["${key}"] contains a "${k}" runtime condition - the browser surface must resolve identically in every runtime`);
      }
      for (const leaf of leaves(exportsMap[key])) {
        const target = leaf.replace(/^\.\//, "");
        const segments = target.split("/");
        if (segments.includes("node") || segments.includes("desktop")) {
          report("exports_map", `${enginePkg}/package.json`,
            `exports["${key}"] -> ${JSON.stringify(leaf)} puts node/desktop code behind the browser surface`);
        } else if (!fs.existsSync(path.join(root, enginePkg, target))) {
          report("exports_map", `${enginePkg}/package.json`, `exports["${key}"] target ${JSON.stringify(leaf)} does not exist`);
        }
      }
    }
  }

  // --- 3. Licence attribution ------------------------------------------------
  const upstreamDir = path.join(root, "packages/office-upstream");
  const upstreamExists = fs.existsSync(upstreamDir);
  const requireLicence = requireUpstreamLicence ?? upstreamExists;
  if (upstreamExists || requireLicence) {
    for (const name of ["LICENSE", "NOTICE"]) {
      const file = path.join(upstreamDir, name);
      if (!fs.existsSync(file)) {
        report("licence", `packages/office-upstream/${name}`, "missing - Apache-2.0 attribution must be vendored");
      } else if (fs.statSync(file).size === 0) {
        report("licence", `packages/office-upstream/${name}`, "empty - attribution must not be a stub");
      }
    }
  }

  return { ok: violations.length === 0, violations };
}

function main() {
  const { ok, violations } = checkBoundaries(REPO_ROOT);
  if (ok) {
    console.log("check-boundaries: OK - browser isolation, no /ee, licence attribution");
    return;
  }
  for (const v of violations) {
    console.error(`check-boundaries: ${v.rule} ${v.file}: ${v.detail}`);
  }
  console.error(`check-boundaries: ${violations.length} violation(s)`);
  process.exitCode = 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();

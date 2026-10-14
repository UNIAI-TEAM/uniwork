/* global process */
// Finds Playwright for the capture provider. D declares it as a devDependency of
// the `e2e` workspace (`@playwright/test`), so that is where it resolves from;
// the fallbacks exist for a VM that installed it elsewhere (and for the unit
// test, which points G7_06_PLAYWRIGHT_FROM at any directory whose node_modules
// holds it). Returns `{chromium, _electron, version}` or null: "not installed"
// is a missing precondition (exit 77), decided by the caller.
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, "..", "..", "..", "..", "..");
const PACKAGES = ["@playwright/test", "playwright", "playwright-core"];

/** Directories to resolve from, most specific first. */
function resolutionBases(env) {
  const bases = [];
  if (env.G7_06_PLAYWRIGHT_FROM) bases.push(resolve(env.G7_06_PLAYWRIGHT_FROM));
  bases.push(join(REPO_ROOT, "e2e"), REPO_ROOT);
  return bases;
}

export function loadPlaywright(env = process.env) {
  for (const base of resolutionBases(env)) {
    const requireFrom = createRequire(join(base, "noop.js"));
    for (const name of PACKAGES) {
      try {
        const lib = requireFrom(name);
        if (lib?.chromium && lib?._electron) {
          let version = "";
          try {
            version = requireFrom(`${name}/package.json`).version ?? "";
          } catch {
            // some packages do not export package.json; the version is informational
          }
          return { chromium: lib.chromium, _electron: lib._electron, version, from: `${name} (via ${base})` };
        }
      } catch {
        // not resolvable from here: try the next package or base
      }
    }
  }
  return null;
}

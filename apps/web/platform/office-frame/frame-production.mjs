// The production-build gate of the web frame (the deployed web must open the genoffice editing
// UI). A development or test build may run without a frame (download / open-in-app only); a build
// that is going to be deployed may not: with a module's bundle missing, every organization would
// see that module's documents as "not set up" with no editor behind them.
import { OFFICE_MODULES } from "./frame-bundle.mjs";

/** A deployed build runs with NODE_ENV=production set on the build command (apps/web/Dockerfile). */
export function isProductionBuild(env) {
  return env.NODE_ENV === "production";
}

/**
 * Throws, with what to do about it, when a production build lacks the verified bundle of any of
 * the six modules. `pinned` is the modules with a pin file, `installed` the ones whose pinned
 * bundle is installed and verifies. Outside production it never throws.
 */
export function assertFrameComplete({ production, source, pinned, installed }) {
  if (!production) return;
  const unpinned = OFFICE_MODULES.filter((module) => !pinned.includes(module));
  const notInstalled = OFFICE_MODULES.filter((module) => pinned.includes(module) && !installed.includes(module));
  if (unpinned.length === 0 && notInstalled.length === 0) return;
  const problems = [];
  if (unpinned.length > 0) problems.push(`no pin for ${unpinned.join(", ")} (apps/web/platform/office-frame/<module>.pin.json)`);
  if (notInstalled.length > 0) {
    problems.push(source
      ? `${notInstalled.join(", ")} not installed: OFFICE_FRAME_SOURCE has no verified build of ${notInstalled.length === 1 ? "it" : "them"}`
      : `${notInstalled.join(", ")} not installed and OFFICE_FRAME_SOURCE is unset`);
  }
  throw new Error(
    `a production build must ship the genoffice editing UI for all of ${OFFICE_MODULES.join(", ")}: ${problems.join("; ")}. `
    + "Set OFFICE_FRAME_SOURCE to the fork's dist-web root (or a .tar.gz / https URL of it) carrying every module "
    + "(docs/office/docs-web-frame.md); a development build does not need it.",
  );
}

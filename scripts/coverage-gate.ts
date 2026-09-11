import fs from "node:fs";
import path from "node:path";

export type CoverageThresholds = {
  statements: number;
  branches: number;
  functions: number;
  lines: number;
};

/**
 * The TypeScript twin of scripts/gate-level.sh, for the vitest configs.
 * Same rules: the committed GATE_LEVEL file is the level, the GATE_LEVEL env
 * var overrides it for one run, and anything that is not one of the three
 * words resolves to strict — a typo must tighten, never loosen.
 */
function gateLevel(): "fast" | "standard" | "strict" {
  const level =
    process.env.GATE_LEVEL ??
    (() => {
      // Walk up from this file: packages/*/vitest.config.ts and the repo root
      // both need to find it, and vitest resolves the config from either.
      let dir = import.meta.dirname;
      for (let i = 0; i < 5; i++) {
        const candidate = path.join(dir, "GATE_LEVEL");
        if (fs.existsSync(candidate)) return fs.readFileSync(candidate, "utf8");
        dir = path.dirname(dir);
      }
      return "";
    })();
  const word = level.trim();
  return word === "fast" || word === "standard" ? word : "strict";
}

/**
 * Coverage thresholds, or nothing at GATE_LEVEL=fast.
 *
 * The numbers themselves never move — docs/adr/0014 and CLAUDE.md keep the
 * ratchet — but at fast a package below one of them prints the summary and
 * passes instead of failing the run. Above fast the drop fails again, with no
 * edit to any config. Returning undefined is what vitest reads as "report the
 * coverage, assert nothing".
 */
export function coverageThresholds(thresholds: CoverageThresholds): CoverageThresholds | undefined {
  return gateLevel() === "fast" ? undefined : thresholds;
}

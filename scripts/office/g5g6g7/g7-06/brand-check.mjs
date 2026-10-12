// The `brand` check (contract 2.4): the rendered text the capture provider
// wrote per fixture, after NFKC, minus format and combining marks, lowercased,
// with whitespace / '-' / '_' / '.' between letters collapsed. `genoffice` or
// `genspark` in that form is a FAIL, and so is a blank render: an empty or
// under-20-visible-character .txt cannot pass a brand check.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capturePairBlocker, HOSTS, fixtureIds, readJsonState, relativeToOut } from "./job-lib.mjs";

const BRANDS = [/genoffice/g, /genspark/g];
const VISIBLE = /[^\s\p{Cc}\p{Cf}\p{Mn}]/gu;
/** A render under this many visible characters is a failure, not a check (2.4). */
export const MIN_VISIBLE_CHARS = 20;

/** How the check reads the text; exported so a test can pin the transform. */
export function normalizeBrandText(text) {
  return String(text)
    .normalize("NFKC")
    .replace(/[\p{Cf}\p{Mn}]/gu, "")
    .toLowerCase()
    .replace(/(?<=\p{L})[\s\-_.]+(?=\p{L})/gu, "");
}

/** How many characters of a render are actually visible (not space or mark). */
export function visibleChars(text) {
  return String(text).match(VISIBLE)?.length ?? 0;
}

/** Every brand hit, each with ±40 characters of the normalised text around it. */
export function brandHits(text) {
  const normalised = normalizeBrandText(text);
  const hits = [];
  for (const brand of BRANDS) {
    brand.lastIndex = 0;
    for (const match of normalised.matchAll(brand)) {
      const at = match.index ?? 0;
      hits.push({ brand: match[0], context: normalised.slice(Math.max(0, at - 40), at + match[0].length + 40) });
    }
  }
  return hits;
}

/**
 * Run the check and write <out>/brand.json.
 *
 * `forkSha` / `pinVersion` are the build the text is about: a capture whose
 * meta.json names another build is blocked (F-04), never scanned.
 * @param {{ capturesDir: string | null, outDir: string, fixtures?: string[], hosts?: string[], forkSha?: string | null, pinVersion?: string | null }} options
 */
export function runBrandCheck({ capturesDir, outDir, fixtures = fixtureIds(), hosts = HOSTS, forkSha = null, pinVersion = null }) {
  if (!capturesDir || !existsSync(capturesDir)) {
    return { status: "BLOCKED", reasons: ["captures_missing"], artifacts: [] };
  }
  const pairs = [];
  for (const host of hosts) {
    const metaState = readJsonState(join(capturesDir, host, "meta.json"));
    for (const fixture of fixtures) {
      const pair = { host, fixture };
      const textPath = join(capturesDir, host, `${fixture}.txt`);
      const blocker = capturePairBlocker(metaState, fixture, { forkSha, pinVersion });
      if (blocker) {
        pairs.push({ ...pair, status: "BLOCKED", reasons: [blocker], hits: [] });
        continue;
      }
      if (!existsSync(textPath)) {
        pairs.push({ ...pair, status: "BLOCKED", reasons: ["rendered_text_missing"], hits: [] });
        continue;
      }
      const text = readFileSync(textPath, "utf8");
      const visible = visibleChars(text);
      if (visible < MIN_VISIBLE_CHARS) {
        pairs.push({ ...pair, status: "FAIL", reasons: ["no_rendered_text"], hits: [], visible });
        continue;
      }
      const hits = brandHits(text);
      pairs.push({ ...pair, status: hits.length > 0 ? "FAIL" : "PASS", reasons: hits.length > 0 ? ["brand_text"] : [], hits, visible });
    }
  }
  const fail = [...new Set(pairs.filter((pair) => pair.status === "FAIL").flatMap((pair) => pair.reasons))];
  const blocked = [...new Set(pairs.filter((pair) => pair.status === "BLOCKED").flatMap((pair) => pair.reasons))];
  const status = fail.length > 0 ? "FAIL" : blocked.length > 0 ? "BLOCKED" : "PASS";
  const artifactPath = join(outDir, "brand.json");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(artifactPath, `${JSON.stringify({ status, pairs }, null, 2)}\n`);
  return { status, reasons: status === "FAIL" ? fail : status === "BLOCKED" ? blocked : [], artifacts: [relativeToOut(outDir, artifactPath)] };
}
// The `brand` check (contract 2.4): the rendered text the capture provider
// wrote per fixture, after NFKD (so a letter that NFKC would compose with its
// mark, `n` + U+0301 -> `ń`, is split first), minus format and combining marks, lowercased,
// with Cyrillic/Greek look-alikes folded to ASCII (F-06) and whitespace /
// '-' / '_' / '.' between letters collapsed. `genoffice` or
// `genspark` in that form is a FAIL, and so is a blank render: an empty or
// under-20-visible-character .txt (the module frame text only) cannot pass a brand check.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capturePairBlocker, HOSTS, fixtureIds, readJsonState, relativeToOut } from "./job-lib.mjs";

const BRANDS = [/genoffice/g, /genspark/g];
const VISIBLE = /[^\s\p{Cc}\p{Cf}\p{Mn}]/gu;
/** A render under this many visible characters is a failure, not a check (2.4). */
export const MIN_VISIBLE_CHARS = 20;

/**
 * The common Latin look-alikes of Cyrillic and Greek letters, folded to ASCII
 * before matching (F-06): `GenΟffice` (Greek omicron) and `Gеnoffice`
 * (Cyrillic е) are the same brand as `GenOffice`. NFKC already covers the
 * fullwidth forms (and NFKD the accented ones); this map holds the shapes a reader cannot tell apart.
 */
const CONFUSABLES = Object.freeze({
  а: "a", в: "b", е: "e", к: "k", м: "m", н: "h", о: "o", п: "n", р: "p", с: "c", т: "t", у: "y", х: "x", ѕ: "s", і: "i", ј: "j", һ: "h",
  α: "a", ε: "e", η: "n", ι: "i", κ: "k", ν: "v", ο: "o", ρ: "p", τ: "t", υ: "u", χ: "x", ω: "w", ϲ: "c",
});
const CONFUSABLE = new RegExp(`[${Object.keys(CONFUSABLES).join("")}]`, "gu");

/** Optional siblings of <fixture>.txt: the web host page text and the desktop shell text. */
const EXTRA_TEXTS = [".host.txt", ".shell.txt"];

function readOptional(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

/** How the check reads the text; exported so a test can pin the transform. */
export function normalizeBrandText(text) {
  return String(text)
    .normalize("NFKD")
    .replace(/[\p{Cf}\p{Mn}]/gu, "")
    .toLowerCase()
    .replace(CONFUSABLE, (character) => CONFUSABLES[character])
    .replace(/(?<=\p{L})[\s\-_.]+(?=\p{L})/gu, "");
}

/** How many characters of a render are actually visible (not space or mark). */
export function visibleChars(text) {
  return String(text).match(VISIBLE)?.length ?? 0;
}

/** Every brand hit, each with ±40 characters of the normalised text around it. */
function brandHits(text) {
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
 * Every brand hit of one capture: the module text plus the host page and the
 * desktop shell texts (optional, older capture dirs have none). Each file is
 * scanned on its own so a hit names its file and a brand cannot be glued
 * together across two files. `--update-goldens` calls this too, so a pair is
 * blessed only when this check would pass it.
 * @param {string} hostDir `<captures>/<host>`
 * @param {string} fixture
 * @param {string} text the already-read `<fixture>.txt`
 */
export function captureBrandHits(hostDir, fixture, text) {
  return [{ file: `${fixture}.txt`, text }, ...EXTRA_TEXTS.map((suffix) => ({ file: `${fixture}${suffix}`, text: readOptional(join(hostDir, `${fixture}${suffix}`)) }))]
    .flatMap((source) => (source.text === null ? [] : brandHits(source.text).map((hit) => ({ ...hit, file: source.file }))));
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
      const hits = captureBrandHits(join(capturesDir, host), fixture, text);
      // the reason names each file with a hit (F-2), so the stdout summary says where without opening brand.json
      const reasons = [...new Set(hits.map((hit) => `brand_text:${host}/${fixture}/${hit.file}`))];
      pairs.push({ ...pair, status: reasons.length > 0 ? "FAIL" : "PASS", reasons, hits, visible });
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
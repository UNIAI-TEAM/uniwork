import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Marketing pages render through `t("landing.…")`. A key that is missing from
 * a locale does not throw: i18next prints the raw key (`landing.demo.send`)
 * on the public page, and only the landing e2e specs noticed — after a locale
 * rewrite dropped the whole `landing.demo` interactive-preview block.
 *
 * `packages/core/i18n/parity.test.ts` cannot catch it: it compares vi with en,
 * and both sides lost the same keys. This scan compares the code with the
 * locales instead. Every literal `landing.*` key in the web app's sources must
 * resolve in vi and in en, as a string, a plural pair, or an object prefix
 * (keys built as `landing.x.${part}` are prefixes and are checked as such).
 */

function flatten(obj, prefix = "", out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    // Arrays flatten by index, the way i18next resolves `list.0.title`.
    if (v && typeof v === "object") flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

const PLURAL = ["_zero", "_one", "_two", "_few", "_many", "_other"];
const SOURCE_DIRS = ["apps/web/features", "apps/web/app", "apps/web/platform"];

function sources(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(p, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) out.push(p);
  }
  return out;
}

/** Literal keys (`"landing.a.b"`) and template prefixes (`` `landing.a.${x}` `` → `landing.a`). */
function landingKeys(source) {
  const keys = new Set();
  const prefixes = new Set();
  for (const m of source.matchAll(/["'`](landing\.[A-Za-z][\w.]*\w)["'`]/g)) {
    if (/\.(css|ts|tsx|js|json|webp|png|svg)$/.test(m[1])) continue;
    keys.add(m[1]);
  }
  for (const m of source.matchAll(/`(landing\.[A-Za-z][\w.]*)\.\$\{/g)) prefixes.add(m[1]);
  return { keys, prefixes };
}

function resolves(dict, key) {
  if (typeof dict[key] === "string") return true;
  return PLURAL.some((suffix) => typeof dict[`${key}${suffix}`] === "string");
}

function hasPrefix(dict, prefix) {
  return Object.keys(dict).some((k) => k.startsWith(`${prefix}.`));
}

test("every landing.* key the web app uses exists in vi and en", () => {
  const locales = Object.fromEntries(
    ["vi", "en"].map((l) => [
      l,
      flatten(JSON.parse(fs.readFileSync(path.join(root, `packages/core/i18n/locales/${l}.json`), "utf8"))),
    ]),
  );
  const missing = [];
  let seen = 0;
  for (const dir of SOURCE_DIRS) {
    for (const file of sources(path.join(root, dir))) {
      const { keys, prefixes } = landingKeys(fs.readFileSync(file, "utf8"));
      const rel = path.relative(root, file).replaceAll("\\", "/");
      for (const [locale, dict] of Object.entries(locales)) {
        for (const key of keys) {
          seen += 1;
          // A literal can also name a namespace handed to a helper (`copy("x")`).
          if (!resolves(dict, key) && !hasPrefix(dict, key)) missing.push(`${locale} ${key} (${rel})`);
        }
        for (const prefix of prefixes) {
          if (!hasPrefix(dict, prefix)) missing.push(`${locale} ${prefix}.* (${rel})`);
        }
      }
    }
  }
  assert.ok(seen > 100, `expected the landing sources to use many landing.* keys, saw ${seen}`);
  assert.deepEqual(missing.sort(), []);
});

test("the scan reads literal keys and template prefixes", () => {
  const { keys, prefixes } = landingKeys(
    't("landing.demo.send"); t(`landing.studio.${key}`); import "./landing.css"; t(ok ? "landing.a.b" : "landing.a.c")',
  );
  assert.deepEqual([...keys].sort(), ["landing.a.b", "landing.a.c", "landing.demo.send"]);
  assert.deepEqual([...prefixes], ["landing.studio"]);
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

function flatten(obj, prefix = "") {
  /** @type {Record<string, string>} */
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key));
    } else {
      out[key] = String(v);
    }
  }
  return out;
}

// i18next plural forms: English counts take `x_one` / `x_other` where Vietnamese, which has no plural, keeps `x`
// (bc17436a4, "1 reply", not "1 replies"). Both name the same string, so a key is compared by that name — but only
// when its `_other` form exists: `poll_pick_one` / `poll_pick_many` are words, not plural forms.
const PLURAL = /_(zero|one|two|few|many|other)$/;

function chatKeys(locale) {
  const raw = JSON.parse(readFileSync(`packages/core/i18n/locales/${locale}.json`, "utf8"));
  const keys = new Set(Object.keys(flatten(raw)).filter((k) => k.startsWith("chat.")));
  return new Set([...keys].map((k) => (PLURAL.test(k) && keys.has(k.replace(PLURAL, "_other")) ? k.replace(PLURAL, "") : k)));
}

test("chat.* i18n keys match between vi and en", () => {
  const vi = chatKeys("vi");
  const en = chatKeys("en");
  const viOnly = [...vi].filter((k) => !en.has(k)).sort();
  const enOnly = [...en].filter((k) => !vi.has(k)).sort();
  assert.equal(viOnly.length, 0, `vi-only: ${viOnly.join(", ")}`);
  assert.equal(enOnly.length, 0, `en-only: ${enOnly.join(", ")}`);
});

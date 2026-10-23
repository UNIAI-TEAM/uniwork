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

function chatKeys(locale) {
  const raw = JSON.parse(readFileSync(`packages/core/i18n/locales/${locale}.json`, "utf8"));
  return new Set(Object.keys(flatten(raw)).filter((k) => k.startsWith("chat.")));
}

test("chat.* i18n keys match between vi and en", () => {
  const vi = chatKeys("vi");
  const en = chatKeys("en");
  const viOnly = [...vi].filter((k) => !en.has(k)).sort();
  const enOnly = [...en].filter((k) => !vi.has(k)).sort();
  assert.equal(viOnly.length, 0, `vi-only: ${viOnly.join(", ")}`);
  assert.equal(enOnly.length, 0, `en-only: ${enOnly.join(", ")}`);
});

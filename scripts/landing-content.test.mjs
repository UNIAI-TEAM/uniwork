import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const locale = name => JSON.parse(fs.readFileSync(new URL(`../packages/core/i18n/locales/${name}.json`, import.meta.url), "utf8")).landing;
const leaves = (value, prefix = "") => Object.entries(value).flatMap(([key, item]) => typeof item === "object" ? leaves(item, `${prefix}${key}.`) : [`${prefix}${key}`]);

test("V2 product copy has Vietnamese and English parity", () => {
  const vi = locale("vi").revision;
  const en = locale("en").revision;
  assert.deepEqual(leaves(vi).sort(), leaves(en).sort());
  for (const copy of [vi, en]) {
    assert.equal(copy.journey.steps.length, 4);
    for (const feature of Object.values(copy.features)) {
      assert.ok(feature.title && feature.description && feature.detailTitle);
      assert.equal(feature.points.length, 3);
      assert.ok(feature.points.every(point => point.length > 20));
    }
    assert.equal(copy.learn.steps.length, 3);
    assert.ok(copy.learn.steps.every(step => step.instructions.length === 2 && step.outcome));
  }
});

test("the connected story preserves confirmation and version review boundaries", () => {
  const copy = locale("en").revision;
  assert.match(copy.journey.steps[1].description, /before confirming/);
  assert.match(copy.journey.steps[2].description, /does not complete/);
  assert.match(copy.journey.steps[3].description, /resubmit/);
  assert.match(copy.features.approvals.points[0], /version/);
  assert.match(copy.features["ai-market"].points[2], /not presented/);
  assert.match(copy.pricingNote, /not a list of included/);
});

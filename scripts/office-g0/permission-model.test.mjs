import { test } from "node:test";
import assert from "node:assert/strict";

import { LEVELS, createAcl, isElevation, levelAtLeast } from "./permission-model.mjs";

// The four protocol levels are the whole vocabulary. Anything else is not a
// level, whatever JavaScript would let a property lookup do with it: inherited
// Object.prototype names, arrays, plain objects, String objects and numbers.
const REFUSED_LEVELS = [
  "owner",
  "VIEW",
  "",
  "edit ",
  "read",
  "admin",
  "toString",
  "constructor",
  "__proto__",
  "valueOf",
  "hasOwnProperty",
  null,
  undefined,
  0,
  1,
  -1,
  NaN,
  true,
  false,
  ["view"],
  ["edit", "manage"],
  {},
  new String("view"),
];

test("all sixteen valid level/floor comparisons follow the declared order", () => {
  assert.deepEqual([...LEVELS], ["view", "comment", "edit", "manage"]);
  const expected = [[true, false, false, false], [true, true, false, false], [true, true, true, false], [true, true, true, true]];
  const pairs = LEVELS.flatMap((held) => LEVELS.map((floor) => [held, floor]));
  assert.equal(pairs.length, 16);
  for (const [held, floor] of pairs) {
    assert.equal(levelAtLeast(held, floor), expected[LEVELS.indexOf(held)][LEVELS.indexOf(floor)], held + " vs " + floor);
  }
  // The boundary the truthiness check got wrong: view is the lowest level, not invalid.
  assert.equal(levelAtLeast("view", "view"), true);
  assert.equal(levelAtLeast("comment", "view"), true);
  assert.equal(levelAtLeast("view", "comment"), false);
  assert.equal(levelAtLeast("edit", "edit"), true);
  assert.equal(levelAtLeast("edit", "manage"), false);
  assert.equal(levelAtLeast("manage", "manage"), true);
});

test("set accepts view, the rank-zero level, and stores every level", () => {
  const acl = createAcl();
  assert.equal(acl.set("account-a", "view"), "view");
  assert.equal(acl.get("account-a"), "view");
  assert.equal(acl.has("account-a", "view"), true);
  assert.equal(acl.has("account-a", "comment"), false);
  for (const level of LEVELS) acl.set("account-" + level, level);
  assert.equal(acl.size(), 5);
});

test("set refuses every non-level value without mutating existing grants", () => {
  const acl = createAcl();
  acl.set("account-a", "edit");
  for (const level of REFUSED_LEVELS) {
    assert.throws(() => acl.set("account-b", level), TypeError, "set accepted: " + String(level));
    assert.throws(() => acl.set("account-a", level), TypeError);
  }
  assert.equal(acl.size(), 1, "a refused set must not add an entry");
  assert.equal(acl.get("account-a"), "edit", "a refused set must not overwrite a grant");
  assert.deepEqual(acl.entries(), [{ accountId: "account-a", level: "edit" }]);
});

test("a refused level leaves the ACL byte-for-byte as it was", () => {
  const acl = createAcl();
  acl.set("account-a", "view");
  acl.set("account-b", "manage");
  const before = acl.entries();
  for (const level of REFUSED_LEVELS) {
    assert.throws(() => acl.set("account-c", level), TypeError);
  }
  assert.deepEqual(acl.entries(), before);
});

test("an invalid held level or floor can never grant access", () => {
  const acl = createAcl();
  acl.set("account-a", "manage");
  for (const badFloor of REFUSED_LEVELS) {
    assert.equal(levelAtLeast("manage", badFloor), false, "floor " + String(badFloor));
    assert.equal(acl.has("account-a", badFloor), false);
  }
  for (const badLevel of REFUSED_LEVELS) {
    assert.equal(levelAtLeast(badLevel, "view"), false, "level " + String(badLevel));
  }
  // Non-string floors never coerce into a level: ["view"] is not "view".
  assert.equal(levelAtLeast("view", ["view"]), false);
  assert.equal(acl.has("account-a", ["view"]), false);
});

test("has agrees with levelAtLeast for a grant, an absent account and a bad floor", () => {
  const acl = createAcl();
  acl.set("account-a", "comment");
  assert.equal(acl.get("account-absent"), null);
  assert.equal(acl.has("account-a", "view"), levelAtLeast("comment", "view"));
  assert.equal(acl.has("account-absent", "view"), levelAtLeast(undefined, "view"));
  assert.equal(acl.has("account-absent", "view"), false);
  assert.equal(acl.has("account-a", "toString"), false);
});

test("delete removes exactly one grant, tolerates an absent account and keeps the rest", () => {
  const acl = createAcl();
  acl.set("account-a", "view");
  acl.set("account-b", "manage");
  acl.delete("account-a");
  assert.equal(acl.get("account-a"), null);
  assert.equal(acl.has("account-a", "view"), false);
  assert.equal(acl.size(), 1);
  assert.deepEqual(acl.entries(), [{ accountId: "account-b", level: "manage" }]);
  acl.delete("account-absent");
  assert.equal(acl.size(), 1);
});

test("entries is a sorted, complete membership snapshot", () => {
  const acl = createAcl();
  acl.set("account-c", "manage");
  acl.set("account-a", "view");
  acl.set("account-b", "edit");
  assert.deepEqual(acl.entries(), [
    { accountId: "account-a", level: "view" },
    { accountId: "account-b", level: "edit" },
    { accountId: "account-c", level: "manage" },
  ]);
});

test("isElevation flags a carried level above the source and ignores a missing carry", () => {
  assert.equal(isElevation({ sourceLevel: "edit", carriedLevel: "manage" }), true);
  assert.equal(isElevation({ sourceLevel: "view", carriedLevel: "comment" }), true);
  assert.equal(isElevation({ sourceLevel: "comment", carriedLevel: "edit" }), true);
  assert.equal(isElevation({ sourceLevel: "manage", carriedLevel: "manage" }), false);
  assert.equal(isElevation({ sourceLevel: "comment", carriedLevel: "view" }), false);
  assert.equal(isElevation({ sourceLevel: "edit", carriedLevel: "edit" }), false);
  assert.equal(isElevation({ sourceLevel: "view", carriedLevel: "view" }), false);
  // Any carried grant when the source had none is an elevation.
  assert.equal(isElevation({ sourceLevel: null, carriedLevel: "view" }), true);
  assert.equal(isElevation({ sourceLevel: undefined, carriedLevel: "view" }), true);
  // No carried grant is never an elevation, whatever the source had.
  assert.equal(isElevation({ sourceLevel: "view", carriedLevel: null }), false);
  assert.equal(isElevation({ sourceLevel: "view", carriedLevel: undefined }), false);
  assert.equal(isElevation({ sourceLevel: null, carriedLevel: null }), false);
});

test("isElevation fails closed on an unrankable level instead of allowing it", () => {
  for (const bad of REFUSED_LEVELS) {
    if (bad === null || bad === undefined) continue; // covered as "no carry" above
    assert.equal(isElevation({ sourceLevel: "edit", carriedLevel: bad }), true, "carried " + String(bad));
    assert.equal(isElevation({ sourceLevel: bad, carriedLevel: "edit" }), true, "source " + String(bad));
  }
});

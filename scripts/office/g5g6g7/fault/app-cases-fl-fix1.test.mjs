// G7-03b (UNI-1382) fix1: the reviewer_be r2 counterexamples (G703-R2-n) as node
// tests on the REGISTERED drivers and the REAL cases.json rows. Every test here
// was RED on 1cd27efc7 (the driver let the counterexample pass) and is GREEN
// after the fix. Not the Electron/OS boundary: that is the cloud run.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fl-fix1.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { join } from "node:path";
import test from "node:test";
import { OFFLINE_DRIVERS } from "./app-case-drivers-offline.mjs";
import { ACCOUNT_A, createWorld } from "./app-cases-fl-fakes.mjs";

/** Runs the registered W1 driver of `rowId`; `tweak(world)` makes the product wrong before it runs. */
async function run(rowId, tweak = () => {}) {
  const world = createWorld(rowId);
  try {
    tweak(world);
    const outcome = await OFFLINE_DRIVERS[rowId](world.ctx);
    const byName = Object.fromEntries(outcome.assertions.map((a) => [a.name, a]));
    return { world, outcome, byName, failed: outcome.assertions.filter((a) => !a.ok).map((a) => a.name) };
  } finally {
    world.clean();
  }
}

// ---- R2-1: FL-03 recovery is a real download plus a committed replacement ------------

test("R2-1: FL-03 a retry that marks the row ready with no download and no blob fails the recovery assertions", async () => {
  const { failed, byName } = await run("FL-03", (world) => {
    world.product.downloadNow = (documentId) => {
      world.rows.set(documentId, { state: "ready", name: "doc" });
      return { ok: true };
    };
  });
  assert.ok(failed.includes("recovery_downloaded_target"), JSON.stringify(byName.recovery_downloaded_target));
  assert.ok(failed.includes("recovered_committed_pin_and_blob"), JSON.stringify(byName.recovered_committed_pin_and_blob));
});

test("R2-1: FL-03 a retry that downloads but commits no replacement blob fails recovered_committed_pin_and_blob", async () => {
  const { failed, byName } = await run("FL-03", (world) => {
    world.product.downloadNow = (documentId) => {
      world.download(documentId);
      world.rows.set(documentId, { state: "ready", name: "doc" });
      return { ok: true };
    };
  });
  assert.equal(byName.recovery_downloaded_target.ok, true, "the download itself happened");
  assert.ok(failed.includes("recovered_committed_pin_and_blob"));
});

test("R2-1: FL-03 a download BEFORE the retry boundary (the initial pin) is not the recovery's", async () => {
  const { byName } = await run("FL-03", (world) => {
    world.product.downloadNow = (documentId) => {
      world.rows.set(documentId, { state: "ready", name: "doc" });
      return { ok: true };
    };
  });
  assert.equal(byName.recovery_downloaded_target.actual, 0, "the initial download does not count");
});

test("R2-1: FL-03 a correct product passes the recovery assertions (a download after the boundary and a replacement blob)", async () => {
  const { byName, failed } = await run("FL-03");
  assert.equal(byName.recovery_downloaded_target.ok, true);
  assert.equal(byName.recovered_committed_pin_and_blob.ok, true);
  assert.deepEqual(failed, []);
});

// ---- R2-2: a malformed offline slice is never an empty library -----------------------

const MALFORMED = { "{}": () => ({}), "array": () => [], "rows: null": () => ({ rows: null }), "rows of non-objects": () => ({ rows: ["x"] }), "a row without a state": () => ({ rows: [{ documentId: "d", name: "n" }] }) };

for (const [label, slice] of Object.entries(MALFORMED)) {
  test(`R2-2: FL-07 a ${label} offline slice fails snapshot_shape and every zero-row claim that leans on it`, async () => {
    const { failed, byName } = await run("FL-07", (world) => {
      const signOut = world.product.signOut;
      world.product.signOut = () => {
        signOut();
        world.offlineSlice = slice;
      };
    });
    assert.ok(failed.includes("snapshot_shape"), JSON.stringify(byName.snapshot_shape));
    assert.ok(failed.includes("signed_out_surface_keeps_no_name"));
    assert.ok(failed.includes("account_b_sees_no_document_name"));
  });

  test(`R2-2: FL-08 a ${label} offline slice on deployment B fails snapshot_shape and deployment_b_library_empty`, async () => {
    const { failed, byName } = await run("FL-08", (world) => {
      const launch = world.ctx.launch;
      world.ctx.launch = async (options) => {
        const session = await launch(options);
        if (options.deploymentId) world.offlineSlice = slice;
        return session;
      };
    });
    assert.ok(failed.includes("snapshot_shape"), JSON.stringify(byName.snapshot_shape));
    assert.ok(failed.includes("deployment_b_library_empty"));
  });
}

// ---- R2-3: a selected-tab failure is a failed assertion -------------------------------

test("R2-3: a tab whose selection never takes fails s3_tab_selected and s3_shot even with the panel still present", async () => {
  for (const id of ["FL-01", "FL-03"]) {
    const { failed, byName } = await run(id, (world) => {
      world.selectionFails = true;
    });
    assert.ok(failed.includes("s3_tab_selected"), `${id}: ${JSON.stringify(byName.s3_tab_selected)}`);
    assert.ok(failed.includes("s3_shot"), `${id}: a shot without a selected tab is no S3 evidence`);
  }
});

test("R2-3: a panel that is not visible right before the capture fails s3_tab_selected", async () => {
  const { failed } = await run("FL-01", (world) => {
    const click = world.ctx.launch;
    world.ctx.launch = async (options) => {
      const session = await click(options);
      const locator = session.shell.locator;
      session.shell.locator = (selector) => {
        const base = locator(selector);
        return { ...base, first() { return this; }, click: async () => { world.tabSelected = true; /* the panel never shows */ } };
      };
      return session;
    };
  });
  assert.ok(failed.includes("s3_tab_selected"));
});

test("R2-3: a selected tab with its visible panel passes s3_tab_selected", async () => {
  const { byName } = await run("FL-01");
  assert.equal(byName.s3_tab_selected.ok, true);
});

// ---- R2-10: a document name is never serialized ---------------------------------------

test("R2-10: FL-07 observing a leaked A document under B reports count + sha256 only, never the name", async () => {
  const secret = "Secret-document-name.docx";
  const { outcome, byName, failed } = await run("FL-07", (world) => {
    world.product.rowsFor = () => [{ documentId: "01JDOCOFA", name: secret, state: "ready" }];
    world.product.signOut = () => { world.signedInAs = null; };
  });
  assert.ok(failed.includes("account_b_sees_no_document_name"), "the leak is still a failure");
  assert.equal(JSON.stringify(outcome).includes(secret), false, "no assertion carries the name");
  assert.equal(JSON.stringify(outcome).includes("Secret-document"), false);
  const actual = byName.account_b_sees_no_document_name.actual;
  assert.match(actual, /1 row/);
  assert.ok(actual.includes(createHash("sha256").update(secret).digest("hex")), actual);
});

// ---- R2-14: no committed target blob while faulted; recovery adds the target records ---

test("R2-14: FL-01 an illicit committed blob while faulted plus an unrelated sync addition after the retry fails no_ready_copy_while_faulted", async () => {
  const { failed, byName } = await run("FL-01", (world) => {
    const pin = world.product.pin;
    world.product.pin = (input) => {
      const result = pin(input);
      world.writeLibrary(input.documentId); // a committed generation although the download was cut
      return result;
    };
    const downloadNow = world.product.downloadNow;
    world.product.downloadNow = (documentId) => {
      // an unrelated sync-store addition lands beside the retry
      world.writeRecord(join(world.userData, "uniwork-sync", "store", "default", ACCOUNT_A, "feed-cursors"), "cursor", Buffer.from("moved"));
      return downloadNow(documentId);
    };
  });
  assert.ok(failed.includes("no_ready_copy_while_faulted"), JSON.stringify(byName.no_ready_copy_while_faulted));
});

test("R2-14: FL-01 a retry that adds only an unrelated sync record (no target blob) fails recovery_adds_target_records", async () => {
  const { failed, byName } = await run("FL-01", (world) => {
    world.product.downloadNow = (documentId) => {
      world.download(documentId);
      world.rows.set(documentId, { state: "ready", name: "doc" });
      world.writeRecord(join(world.userData, "uniwork-sync", "store", "default", ACCOUNT_A, "feed-cursors"), "cursor", Buffer.from("moved"));
      return { ok: true };
    };
  });
  assert.ok(failed.includes("recovery_adds_target_records"), JSON.stringify(byName.recovery_adds_target_records));
});

test("R2-14: FL-01 a correct product has no blob while faulted and gains the target records on recovery", async () => {
  const { byName, failed } = await run("FL-01");
  assert.equal(byName.no_ready_copy_while_faulted.actual, 0);
  assert.equal(byName.recovery_adds_target_records.ok, true);
  assert.deepEqual(failed, []);
});

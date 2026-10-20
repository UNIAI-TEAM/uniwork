// G7-03b (UNI-1382) review r1 R1-15: the REGISTERED driver of each ready FL row
// runs on its REAL cases.json row against a fake app, proxy and store
// (app-cases-fl-fakes.mjs). The product is correct by default and a test changes
// one behavior, so a driver that cannot finish (R1-1/2: a missing expect key
// throws inside the driver), that reads the wrong thing or that lets a wrong
// product PASS fails here. Not the Electron boundary: that is the cloud run.
// Run: node --test scripts/office/g5g6g7/fault/app-cases-fl-drivers.test.mjs
import "./app-cases-fl-fast.mjs";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { AppBlocked } from "./app-session.mjs";
import { OFFLINE_DRIVERS, libraryBlobs, libraryStoreDir } from "./app-case-drivers-offline.mjs";
import { ACCOUNT_A, ACCOUNT_B, createWorld } from "./app-cases-fl-fakes.mjs";

/** Runs the registered driver of `rowId`; `tweak(world)` makes the product wrong before it runs. */
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

const OFFLINE_ROWS = ["FL-01", "FL-03", "FL-07", "FL-08"];

for (const id of OFFLINE_ROWS) {
  test(`${id}: the registered driver runs on its real cases.json row and a correct product passes every assertion`, async () => {
    const { outcome, failed } = await run(id);
    // R1-1/R1-2: a key the row lacks throws inside the driver and never reaches here
    assert.equal(outcome.blocker, undefined);
    assert.ok(outcome.assertions.length >= 8, "the driver produced its assertions");
    assert.deepEqual(failed, [], `${id}: ${JSON.stringify(outcome.assertions.filter((a) => !a.ok))}`);
  });
}

test("every driver builds its S3/S11 shots as assertions, and a declared shot that is missing from the row artifacts does not exist", async () => {
  for (const id of OFFLINE_ROWS) {
    const { outcome, world } = await run(id);
    const shots = outcome.assertions.filter((a) => /^s(3|11)_shot$/.test(a.name));
    assert.ok(shots.length >= 1, `${id}: no shot assertion`);
    const declared = world.row.artifacts.filter((name) => name.endsWith(".png"));
    assert.deepEqual(shots.map((s) => s.expected).sort(), declared.sort(), `${id}: the shots asserted are exactly the shots declared`);
  }
});

// ---- FL-01 ------------------------------------------------------------------------

test("FL-01: a product that reads ready over the cut download fails never_ready_while_faulted", async () => {
  const { failed } = await run("FL-01", (world) => {
    world.product.pin = ({ documentId }) => {
      world.download(documentId);
      world.rows.set(documentId, { state: "ready", name: "doc" });
      world.writeLibrary(documentId);
      return { ok: true };
    };
  });
  assert.ok(failed.includes("row_faulted"), "the row never read interrupted");
});

test("FL-01: a cut that never reached the proxy is not evidence of the fault (the rule's own log line is required)", async () => {
  const { failed, byName } = await run("FL-01", (world) => {
    // the app goes `interrupted` for some other reason: the content GET never meets the rule
    world.product.pin = ({ documentId }) => {
      world.log.push({ method: "GET", path: `/api/v1/documents/${documentId}/download`, status: 200, ruleId: null });
      world.rows.set(documentId, { state: "interrupted", name: "doc" });
      return { ok: true };
    };
  });
  assert.ok(failed.includes("fault_rule_hit"), JSON.stringify(byName.fault_rule_hit));
});

test("FL-01: the faulted store reading is taken while the rule is armed and written beside before/after", async () => {
  const world = createWorld("FL-01");
  try {
    await OFFLINE_DRIVERS["FL-01"](world.ctx);
    for (const name of ["offline-store-before.json", "offline-store-faulted.json", "offline-store-after.json"]) {
      assert.ok(readdirSync(world.runDir).includes(name), `${name} was written`);
    }
    const faulted = JSON.parse(readFileSync(join(world.runDir, "offline-store-faulted.json"), "utf8"));
    // the fork's reservation writes the pin row and the index before the download (manager.ts reserve); no blob may exist yet
    assert.equal(libraryBlobs(faulted, [...world.rows.keys()]).length, 0, "while faulted no committed blob exists yet");
  } finally {
    world.clean();
  }
});

// ---- FL-03 ------------------------------------------------------------------------

test("FL-03: a product that serves the tampered cache (open ok, row ready) fails never_served and open_refused_as_corrupt", async () => {
  const { failed } = await run("FL-03", (world) => {
    world.product.open = (documentId) => {
      world.download(documentId);
      return { ok: true };
    };
  });
  assert.ok(failed.includes("never_served_tampered_bytes"));
  assert.ok(failed.includes("open_refused_as_corrupt"));
});

test("FL-03: no offlineOpen API, a thrown call or an unrelated code is not a corrupt refusal (R1-5)", async () => {
  for (const code of ["no_offline_open_api", "offlineOpen_threw: boom", "offline"]) {
    const { failed, byName } = await run("FL-03", (world) => {
      world.product.open = (documentId) => {
        world.download(documentId);
        return { ok: false, code };
      };
    });
    assert.ok(failed.includes("open_refused_as_corrupt"), `${code}: ${JSON.stringify(byName.open_refused_as_corrupt)}`);
  }
});

test("FL-03: the tamper hits ciphertext, the open meets the cache only through the cut route, and the refusal is the verification's", async () => {
  const { byName, failed } = await run("FL-03");
  assert.equal(byName.open_path_cut.ok, true, "the cut-open rule was hit on the document's download route");
  assert.equal(byName.open_refused_as_corrupt.actual, "corrupt");
  assert.equal(byName.row_state_after_open.actual, "corrupt");
  assert.equal(byName.tampered_ciphertext_dropped.actual, 0);
  assert.equal(byName.recovered_bytes_are_not_the_tampered_ones.ok, true);
  assert.deepEqual(failed, []);
});

test("FL-03: recovery is its own claim - a row that stays corrupt after the retry fails row_recovered", async () => {
  const { failed } = await run("FL-03", (world) => {
    world.product.downloadNow = (documentId) => {
      world.download(documentId);
      return { ok: true };
    };
  });
  assert.ok(failed.includes("row_recovered"));
});

test("FL-03: an online open that never meets the cache (the route not cut) cannot pass for a refusal", async () => {
  const { failed } = await run("FL-03", (world) => {
    world.ctx.setRules = async () => { world.rules = []; };
  });
  assert.ok(failed.includes("open_path_cut"), "no rule hit: the open went to the server");
  assert.ok(failed.includes("open_refused_as_corrupt"));
});

test("FL-03: a snapshot that cannot answer while the app is alive is a FAIL assertion, never an empty library", async () => {
  const { failed, byName } = await run("FL-03", (world) => {
    const sessionFor = world.ctx.launch;
    world.ctx.launch = async (options) => {
      const session = await sessionFor(options);
      if (world.launches.length === 2) world.snapshotWorks = false;
      return session;
    };
  });
  // the first launch pins and waits for ready with a working snapshot; the relaunch has none
  assert.ok(failed.includes("snapshot_before_open"), JSON.stringify(byName.snapshot_before_open));
});

test("FL-03: an empty pre-store (the pin wrote no record) fails pre_store_has_the_pinned_copy", async () => {
  const { failed } = await run("FL-03", (world) => {
    world.product.pin = ({ documentId }) => {
      world.download(documentId);
      world.rows.set(documentId, { state: "ready", name: "doc" });
      return { ok: true };
    };
  });
  assert.ok(failed.includes("pre_store_has_the_pinned_copy"));
  assert.ok(failed.includes("blobs_tampered"), "nothing in the store to tamper");
});

test("FL-03: a relaunch that is not account A fails relaunched_as_account_a", async () => {
  const { failed } = await run("FL-03", (world) => {
    const launch = world.ctx.launch;
    world.ctx.launch = async (options) => {
      const session = await launch(options);
      if (world.launches.length === 2) world.signedInAs = ACCOUNT_B;
      return session;
    };
  });
  assert.ok(failed.includes("relaunched_as_account_a"));
});

test("FL-03: a failed S11 capture fails the row's shot assertion; S3 and S11 are asserted separately", async () => {
  const { failed, byName } = await run("FL-03", (world) => {
    const product = world.product.open;
    world.product.open = (documentId) => {
      const result = product(documentId);
      world.visible.clear();
      return result;
    };
  });
  assert.ok(failed.includes("s11_shot"), JSON.stringify(byName.s11_shot));
});

// ---- FL-07 ------------------------------------------------------------------------

test("FL-07: it declares the S3 shot only (signed-out S3 is the surface; no S11 lock path exists without a session)", async () => {
  const { byName, world } = await run("FL-07");
  assert.deepEqual(world.row.artifacts.filter((a) => a.endsWith(".png")), ["s3-signed-out-pane.png"]);
  assert.equal(byName.s3_shot.ok, true);
  assert.equal(byName.s11_shot, undefined);
});

test("FL-07: an empty pre-store cannot make the wipe vacuously true", async () => {
  const { failed } = await run("FL-07", (world) => {
    world.product.pin = ({ documentId }) => {
      world.download(documentId);
      world.rows.set(documentId, { state: "ready", name: "doc" });
      return { ok: true };
    };
  });
  assert.ok(failed.includes("pre_store_has_the_pinned_copy"));
});

test("FL-07: a sign-in that lands on the wrong account fails signed_in_as_account_b", async () => {
  const { failed } = await run("FL-07", (world) => {
    world.signInYields = ACCOUNT_A;
  });
  assert.ok(failed.includes("signed_in_as_account_b"));
});

test("FL-07: a missing snapshot is a FAIL assertion for the signed-out and the B reading, not zero rows", async () => {
  const { failed } = await run("FL-07", (world) => {
    const signOut = world.product.signOut;
    world.product.signOut = () => {
      signOut();
      world.snapshotWorks = false;
    };
  });
  assert.ok(failed.includes("snapshot_while_signed_out"));
  assert.ok(failed.includes("signed_out_surface_keeps_no_name"), "an unanswered snapshot never satisfies the privacy claim");
  assert.ok(failed.includes("snapshot_as_account_b"));
  assert.ok(failed.includes("account_b_sees_no_document_name"));
});

test("FL-07: a sign-out that leaves A's ciphertext in the store fails account_a_scope_wiped", async () => {
  const { failed } = await run("FL-07", (world) => {
    world.product.signOut = () => {
      world.rows.clear();
      world.signedInAs = null;
    };
  });
  assert.ok(failed.includes("account_a_scope_wiped"));
});

test("FL-07: B seeing A's row fails the zero-row claims", async () => {
  const { failed } = await run("FL-07", (world) => {
    world.product.rowsFor = () => [{ documentId: "01JDOCOFA", name: "Hop-dong-cua-A.docx", state: "ready" }];
    world.product.signOut = () => { world.signedInAs = null; };
  });
  assert.ok(failed.includes("account_b_rows"));
  assert.ok(failed.includes("account_b_sees_no_document_name"));
});

// ---- FL-08 ------------------------------------------------------------------------

test("FL-08: an env deployment that the app does not honor (a saved profile wins) fails deployment_b_is_effective", async () => {
  const { failed, byName } = await run("FL-08", (world) => {
    world.effectiveDeployment = "default";
  });
  assert.ok(failed.includes("deployment_b_is_effective"), JSON.stringify(byName.deployment_b_is_effective));
});

test("FL-08: a saved deployment profile in userData fails deployment_b_is_effective even when the env matches", async () => {
  const world = createWorld("FL-08");
  try {
    const launch = world.ctx.launch;
    world.ctx.launch = async (options) => {
      const session = await launch(options);
      if (options.deploymentId) (await import("node:fs")).writeFileSync(join(world.userData, "deployment-profile.json"), "{}");
      return session;
    };
    const outcome = await OFFLINE_DRIVERS["FL-08"](world.ctx);
    assert.equal(outcome.assertions.find((a) => a.name === "deployment_b_is_effective").ok, false);
  } finally {
    world.clean();
  }
});

test("FL-08: an unanswered snapshot on B is a FAIL, not an empty library", async () => {
  const { failed } = await run("FL-08", (world) => {
    const launch = world.ctx.launch;
    world.ctx.launch = async (options) => {
      const session = await launch(options);
      if (options.deploymentId) world.snapshotWorks = false;
      return session;
    };
  });
  assert.ok(failed.includes("snapshot_on_deployment_b"));
  assert.ok(failed.includes("deployment_b_library_empty"));
});

test("FL-08: a change in any registered store of A's scope (a feed cursor) fails deployment_a_scope_unchanged", async () => {
  const { failed } = await run("FL-08", (world) => {
    const launch = world.ctx.launch;
    world.ctx.launch = async (options) => {
      const session = await launch(options);
      if (options.deploymentId) {
        // the deployment switch touches A's feed-cursors store
        world.writeRecord(join(world.userData, "uniwork-sync", "store", "default", ACCOUNT_A, "feed-cursors"), "cursor", Buffer.from("moved"));
      }
      return session;
    };
  });
  assert.ok(failed.includes("deployment_a_scope_unchanged"));
});

test("FL-08: deployment B's copies are counted over B's own deployment folder", async () => {
  const { failed } = await run("FL-08", (world) => {
    const launch = world.ctx.launch;
    world.ctx.launch = async (options) => {
      const session = await launch(options);
      if (options.deploymentId) {
        world.writeRecord(join(world.userData, "uniwork-documents", options.deploymentId, "01JOTHER", "abc@offline"), "x", Buffer.from("PLAINTEXT"));
      }
      return session;
    };
  });
  assert.ok(failed.includes("deployment_b_copies"));
});

// ---- harness death (R1-13) ----------------------------------------------------------

for (const id of OFFLINE_ROWS) {
  test(`${id}: an app that dies during the run is BLOCKED, never a product FAIL`, async () => {
    const world = createWorld(id);
    try {
      const launch = world.ctx.launch;
      let launches = 0;
      world.ctx.launch = async (options) => {
        const session = await launch(options);
        launches += 1;
        // the app dies right after its first launch's pin: the next operation throws
        const pin = world.product.pin;
        world.product.pin = (input) => {
          const result = pin(input);
          world.alive = false;
          return result;
        };
        return session;
      };
      await assert.rejects(() => OFFLINE_DRIVERS[id](world.ctx), (error) => error instanceof AppBlocked && /harness down|stopped/.test(error.message));
      assert.ok(launches >= 1);
    } finally {
      world.clean();
    }
  });

  test(`${id}: an app that never comes up is BLOCKED, never a product FAIL`, async () => {
    const world = createWorld(id);
    try {
      world.launchFails = true;
      await assert.rejects(() => OFFLINE_DRIVERS[id](world.ctx), (error) => error instanceof AppBlocked && /did not come up/.test(error.message));
    } finally {
      world.clean();
    }
  });
}

test("FL-01: a product error while the app stays alive is re-thrown as the product's own failure, not BLOCKED", async () => {
  const world = createWorld("FL-01");
  try {
    world.product.downloadNow = () => {
      throw new Error("downloadNow exploded");
    };
    // the app answers the evaluate with a rejection the driver converts to a result; a throw outside the app is the harness's
    world.ctx.newDocument = async () => {
      throw new Error("seed exploded");
    };
    await assert.rejects(() => OFFLINE_DRIVERS["FL-01"](world.ctx), (error) => !(error instanceof AppBlocked) && /seed exploded/.test(error.message));
  } finally {
    world.clean();
    rmSync(world.root, { recursive: true, force: true });
  }
});

test("libraryStoreDir is the fork's scope path the fake writes to, so the collector reads real records", async () => {
  const world = createWorld("FL-01");
  try {
    await OFFLINE_DRIVERS["FL-01"](world.ctx);
    assert.ok(readdirSync(libraryStoreDir(world.userData, "default", ACCOUNT_A)).length >= 3);
  } finally {
    world.clean();
  }
});

// CONTRACT-v1 lab adapter tests: the reconciled lab server from ./replica plus the added
// lab-bridge module. Node 22 built-ins only.
//
//   node --test candidate/lab-bridge.test.mjs
//
// What is REAL here: the reconciled lab server, its HTTP transport, its dispatch/validation, the
// files it writes, the receipts it publishes, the digests it recomputes from disk, and the engine
// CALL ATTRIBUTION. What is INJECTED: the engine answers for pdf/xlsx/pptx (registered through the
// lab's own engineHandlers injection), so no engine host is booted by this file and engine.host is
// null in those receipts. A browser cycle is NOT claimed here - that belongs to the format slices
// and their Tester.

import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createServer as createProbeServer } from "node:net";
import http from "node:http";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Integrated into M by the Advisor (g118): the lab host under test is this directory's own
// lab-server.mjs / lab-bridge.mjs, the contract lives in docs/office/g0, scratch goes to .uniwork-dev/tmp.
const REPLICA = path.resolve(HERE, "..", "..");
const S = path.join(REPLICA, "docs", "office", "g0");
const LAB_DIR_MODULE = path.join(REPLICA, "e2e", "office-g0", "lab-server.mjs");
const BRIDGE_MODULE = path.join(REPLICA, "e2e", "office-g0", "lab-bridge.mjs");
const TMP = path.join(REPLICA, ".uniwork-dev", "tmp", "lab-bridge.test");
const APP_PORT = 5608;
const PREVIEW_PORT = 5609;

const { createLabServer } = await import(pathToFileURL(LAB_DIR_MODULE).href);
const bridgeModule = await import(pathToFileURL(BRIDGE_MODULE).href);
const { BRIDGE_CONTRACT, createBridge, receiptDigest } = bridgeModule;

const sha256 = (data) => crypto.createHash("sha256").update(Buffer.isBuffer(data) ? data : Buffer.from(data)).digest("hex");
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.7871.250 Safari/537.36";

let caseCounter = 0;
/** A fresh, isolated lab tree per case, always inside M/.uniwork-dev/tmp. */
function makeCase({ fixtures = {}, manifestEntries = null, tamperFixture = null, manifestBroken = false } = {}) {
  caseCounter += 1;
  const root = path.join(TMP, "case-" + caseCounter);
  fs.rmSync(root, { recursive: true, force: true });
  const manifestPath = path.join(root, "docs", "office", "g0", "fixtures", "manifest.json");
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  // The real layout: entry paths are repository-relative and their bytes live under files/ beside
  // the manifest, which is exactly how M/docs/office/g0/fixtures is laid out.
  const fixtureRoot = path.join(path.dirname(manifestPath), "files");
  const entries = [];
  for (const [id, spec] of Object.entries(fixtures)) {
    const abs = path.join(fixtureRoot, spec.path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, spec.bytes);
    entries.push({
      id, path: spec.path, bytes: spec.bytes.length,
      sha256: sha256(spec.bytes).toUpperCase(),
      ...(spec.extra ?? {}),
    });
  }
  const chosen = manifestEntries ?? entries;
  const manifest = manifestBroken
    ? { schemaVersion: 1, kind: "uniwork-office-fixture-manifest", fixtures: [{ id: "F-BROKEN" }] }
    : { schemaVersion: 1, kind: "uniwork-office-fixture-manifest", fixtures: chosen };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  if (tamperFixture) fs.writeFileSync(path.join(fixtureRoot, tamperFixture.path), tamperFixture.bytes);
  const labDir = path.join(root, "lab");
  const buildsDir = path.join(root, "builds");
  fs.mkdirSync(buildsDir, { recursive: true });
  return { root, manifestPath, fixtureRoot, labDir, buildsDir, manifestSha256: sha256(fs.readFileSync(manifestPath)) };
}

/** The prepared source's own package identities, as the runner would generate them. */
function writeEngineIdentity(root) {
  const file = path.join(root, "engine-identity.json");
  fs.writeFileSync(file, JSON.stringify({
    docs: { name: "@genoffice/docs", version: "0.1.0", runtime: "browser-renderer" },
    markdown: { name: "@genoffice/markdown", version: "0.1.0", runtime: "browser-renderer" },
    html: { name: "@genoffice/html", version: "0.1.0", runtime: "browser-renderer" },
    pdf: { name: "@genoffice/pdf", version: "0.1.0", runtime: "engine-host-http" },
    sheets: { name: "@genoffice/sheets", version: "0.1.0", runtime: "engine-host-http" },
    slides: { name: "@genoffice/slides", version: "0.1.0", runtime: "engine-host-http" },
  }, null, 2));
  return file;
}

/** Injected engine answers. They write REAL bytes into the view's native output dir. */
function injectedEngine(labDir, overrides = {}) {
  const publish = (viewId, name, bytes) => {
    const dir = path.join(labDir, "out", viewId);
    fs.mkdirSync(dir, { recursive: true });
    const target = path.join(dir, name);
    fs.writeFileSync(target, bytes);
    return target;
  };
  return {
    handlers: {
      "pdf-save": async (input) => {
        const target = publish(input.viewId, "saved.pdf", Buffer.from("%PDF-1.7\nsaved-by-injected-engine\n"));
        return { ok: true, path: target, bytes: fs.statSync(target).size, sha256: overrides.pdfDeclaredSha256 ?? undefined };
      },
      "xlsx-save": async (input) => {
        const target = publish(input.viewId, "saved.xlsx", Buffer.from("PK-injected-workbook-bytes"));
        return { ok: true, status: "ok", saved: { path: target, sha256: overrides.xlsxDeclaredSha256 ?? undefined } };
      },
      "pptx-open": async (input) => ({ ok: true, viewId: input.viewId, slides: [], count: 0 }),
      "pptx-save": async (input) => {
        const target = publish(input.viewId, input.name ?? "saved.pptx", Buffer.from("PK-injected-deck-bytes"));
        return { ok: true, path: target, count: 1, sha256: overrides.pptxDeclaredSha256 ?? undefined };
      },
      ...overrides.handlers,
    },
  };
}

/**
 * The lab owns fixed ports, so a test waits until they are really free before listening - the same
 * discipline run-lab.mjs uses. A held port is a diagnosable failure, never a silent one.
 */
async function waitForFree(port, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const free = await new Promise((resolve) => {
      const probe = createProbeServer();
      probe.once("error", () => resolve(false));
      probe.once("listening", () => probe.close(() => resolve(true)));
      probe.listen(port, "127.0.0.1");
    });
    if (free) return;
    if (Date.now() > deadline) throw new Error("port " + port + " did not become free within " + timeoutMs + "ms");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function withLab(caseSpec, options, run) {
  await waitForFree(APP_PORT);
  await waitForFree(PREVIEW_PORT);
  const engineIdentityFile = writeEngineIdentity(caseSpec.root);
  const server = createLabServer({
    buildsDir: caseSpec.buildsDir,
    labDir: caseSpec.labDir,
    fixturesDir: path.join(caseSpec.root, "docs"),
    fixtureManifest: caseSpec.manifestPath,
    // No fixtureRoot: the default rule (<manifest dir>/files) must resolve these, like M does.
    orcaVersion: "1.4.209",
    orcaVersionSource: "--orca-version (test)",
    engineBaseUrl: options.engineBaseUrl ?? null,
    engineHandlers: options.engineHandlers ?? {},
    engineIdentity: engineIdentityFile,
    port: APP_PORT,
    previewPort: PREVIEW_PORT,
  });
  await server.listen();
  const post = (channel, body, headers = {}) =>
    postJson(APP_PORT, channel, body, headers);
  try {
    return await run({ server, post, engineIdentityFile });
  } finally {
    await server.close();
  }
}

/**
 * A fresh connection per request (`agent: false`): a keep-alive pool would reuse a socket from the
 * previous case's server on the same port and report a spurious reset.
 */
function postJson(port, channel, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(JSON.stringify(body ?? {}));
    const request = http.request({
      host: "127.0.0.1",
      port,
      path: "/lab/" + channel,
      method: "POST",
      agent: false,
      headers: {
        "content-type": "application/json",
        "user-agent": UA,
        "content-length": payload.length,
        connection: "close",
        ...headers,
      },
    }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = null;
        }
        resolve({ status: response.statusCode, body: parsed });
      });
    });
    request.on("error", (error) => reject(new Error("POST /lab/" + channel + " failed: " + error.message + " (" + (error.code ?? "no-code") + ")")));
    request.end(payload);
  });
}

test("the manifest fixture root defaults to files/ beside the manifest, the rule paths.mjs owns", () => {
  const spec = makeCase({ fixtures: { "F-DOCX-KITCHEN": { path: "docs/docx-kitchen-sink.docx", bytes: DOCX_FIXTURE } } });
  const bridge = createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath });
  assert.equal(bridge.manifest.root, spec.fixtureRoot);
  assert.equal(bridge.manifest.root, path.join(path.dirname(spec.manifestPath), "files"));
  const resolved = bridge.resolveOpenTarget({ app: "docs", target: "F-DOCX-KITCHEN" });
  assert.equal(resolved.sourcePath, path.join(spec.fixtureRoot, "docs", "docx-kitchen-sink.docx"));
  assert.equal(resolved.fixture.byteEqualToManifest, true);
  // An explicit --fixture-root still wins.
  const other = createBridge({ labDir: path.join(spec.root, "lab2"), manifestPath: spec.manifestPath, fixtureRoot: spec.root });
  assert.equal(other.manifest.root, spec.root);
});

const DOCX_FIXTURE = Buffer.from("docx-fixture-bytes-0123456789abcdef");
const MD_FIXTURE = Buffer.from("# G0 markdown fixture\n\n| a | b |\n| - | - |\n");
const HTML_FIXTURE = Buffer.from("<html><body><p id=\"edit-me\">fixture</p></body></html>");
const PDF_FIXTURE = Buffer.from("%PDF-1.7\nfixture-pdf-bytes\n");
const XLSX_FIXTURE = Buffer.from("PK-fixture-workbook");
const PPTX_FIXTURE = Buffer.from("PK-fixture-deck");

const ALL_FIXTURES = {
  "F-DOCX-KITCHEN": { path: "docs/docx-kitchen-sink.docx", bytes: DOCX_FIXTURE },
  "F-MD-KITCHEN": { path: "docs/md-kitchen-sink.md", bytes: MD_FIXTURE },
  "F-HTML-KITCHEN": { path: "docs/html-kitchen-sink.html", bytes: HTML_FIXTURE },
  "F-PDF-KITCHEN": { path: "docs/pdf-kitchen-sink.pdf", bytes: PDF_FIXTURE },
  "F-XLSX-KITCHEN": { path: "docs/xlsx-kitchen-sink.xlsx", bytes: XLSX_FIXTURE },
  "F-PPTX-KITCHEN": { path: "docs/pptx-kitchen-sink.pptx", bytes: PPTX_FIXTURE },
};

test("the bridge is the frozen contract string and every covered save channel is wired", () => {
  assert.equal(BRIDGE_CONTRACT, "uniwork-office-lab-bridge@1");
  const contract = JSON.parse(fs.readFileSync(path.join(S, "contract-v1.json"), "utf8"));
  assert.equal(contract.contract.string, BRIDGE_CONTRACT);
  const wired = Object.keys(bridgeModule.BRIDGE_SAVE_CHANNELS);
  const declared = contract.formats.flatMap((entry) => entry.saveChannels);
  assert.deepEqual([...wired].sort(), [...new Set(declared)].sort());
  // The reconcile only hooks what the contract covers: a non-save channel must not be a bridge save.
  assert.equal(bridgeModule.bridgeChannelForOp("text-save-image"), null);
  assert.equal(bridgeModule.bridgeChannelForOp("slides-txn"), null);
  for (const entry of contract.formats) {
    assert.equal(bridgeModule.OPERATION_ID_FOR_FORMAT[entry.format], entry.operationIds[0], entry.format);
  }
});

test("a bad manifest fails the boot, not the first open", () => {
  const broken = makeCase({ fixtures: { "F-DOCX-KITCHEN": { path: "docs/x.docx", bytes: DOCX_FIXTURE } }, manifestBroken: true });
  assert.throws(
    () => createBridge({ labDir: broken.labDir, manifestPath: broken.manifestPath, fixtureRoot: broken.root }),
    (error) => error.code === "fixture_manifest_invalid",
  );
  assert.throws(
    () => createBridge({ labDir: broken.labDir, manifestPath: path.join(broken.root, "nope.json"), fixtureRoot: broken.root }),
    (error) => error.code === "fixture_manifest_missing",
  );
  // A manifest-free bridge is a valid lab (raw-path sessions keep working); it refuses a fixture ID
  // at open time instead, which the next case asserts.
  const manifestFree = createBridge({ labDir: broken.labDir });
  assert.throws(
    () => manifestFree.resolveOpenTarget({ app: "docs", target: "F-DOCX-KITCHEN" }),
    (error) => error.code === "fixture_manifest_missing",
  );
});

test("NEGATIVE wrong fixture bytes are refused by fixture_identity_mismatch and no view is created", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES, tamperFixture: { path: "docs/docx-kitchen-sink.docx", bytes: Buffer.concat([DOCX_FIXTURE, Buffer.from("-stale-lane-copy")]) } });
  await withLab(spec, {}, async ({ post, server }) => {
    const answer = await post("lab:session-open", { app: "docs", path: "F-DOCX-KITCHEN" });
    assert.equal(answer.status, 409);
    assert.equal(answer.body.ok, false);
    assert.equal(answer.body.error, "fixture_identity_mismatch");
    assert.equal(answer.body.details.fixtureId, "F-DOCX-KITCHEN");
    assert.equal(answer.body.details.observedBytes, DOCX_FIXTURE.length + "-stale-lane-copy".length);
    assert.equal(answer.body.details.expectedBytes, DOCX_FIXTURE.length);
    assert.match(answer.body.details.observedSha256, /^[0-9a-f]{64}$/);
    assert.equal(answer.body.details.expectedSha256, sha256(DOCX_FIXTURE));
    assert.equal(fs.existsSync(path.join(spec.labDir, "views")), true, "the lab dir exists");
    assert.deepEqual(fs.readdirSync(path.join(spec.labDir, "views")), [], "a refused open creates no view");
    assert.equal((server.records() ?? []).some((entry) => entry.op === "session-open"), false);
  });
});

test("NEGATIVE an unknown manifest id and a manifest-free lab refuse by name", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  await withLab(spec, {}, async ({ post }) => {
    const missing = await post("lab:session-open", { app: "docs", path: "F-DOCX-NOT-THERE" });
    assert.equal(missing.status, 400);
    assert.equal(missing.body.error, "fixture_not_in_manifest");
  });
  const noManifest = makeCase({ fixtures: {} });
  const server = createLabServer({
    buildsDir: noManifest.buildsDir, labDir: noManifest.labDir, fixturesDir: path.join(noManifest.root, "docs"),
    port: APP_PORT, previewPort: PREVIEW_PORT,
  });
  await server.listen();
  try {
    const answer = await postJson(APP_PORT, "lab:session-open", { app: "docs", path: "F-DOCX-KITCHEN" });
    assert.equal(answer.status, 500);
    assert.equal(answer.body.error, "fixture_manifest_missing");
  } finally {
    await server.close();
  }
});

test("a second save on one channel records only its own engine call", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const engine = injectedEngine(spec.labDir);
  await withLab(spec, { engineHandlers: engine }, async ({ post }) => {
    const open = await post("lab:session-open", { app: "sheets", path: "F-XLSX-KITCHEN" });
    const viewId = open.body.result.viewId;
    await post("host:sheets-select-workbook", { viewId, path: null });
    const first = await post("host:sheets-save-edits", { viewId, edits: [{ sheetId: "s1", row: 0, column: 0, writeValue: true, value: "one" }], name: "one.xlsx" });
    const second = await post("host:sheets-save-edits", { viewId, edits: [{ sheetId: "s1", row: 0, column: 0, writeValue: true, value: "two" }], name: "two.xlsx" });
    const firstReceipt = JSON.parse(fs.readFileSync(first.body.result.bridge.receiptPath, "utf8"));
    const secondReceipt = JSON.parse(fs.readFileSync(second.body.result.bridge.receiptPath, "utf8"));
    assert.deepEqual(firstReceipt.engine.operations, ["xlsx-save"]);
    assert.deepEqual(secondReceipt.engine.operations, ["xlsx-save"], "the second save must not inherit the first save's call");
    assert.deepEqual(secondReceipt.engine.sessionOperations, ["xlsx-open", "xlsx-save", "xlsx-save"], "the session list still shows every call of the view");
    assert.equal(secondReceipt.receipt.sequence, 2);
  });
});

test("receipt sequences continue across a recreated bridge and an existing receipt is never overwritten", () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const session = { viewId: "view-sequence", app: "markdown", sourceReal: path.join(spec.fixtureRoot, "docs", "md-kitchen-sink.md"), sourceName: "md-kitchen-sink.md", sourceBytes: MD_FIXTURE.length, sourceHash: sha256(MD_FIXTURE) };
  const target = path.join(spec.labDir, "views", "view-sequence", "input", "md-kitchen-sink.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "# sequence\n");
  const first = createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath });
  const second = createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath });
  const one = first.recordSave({ channel: "host:text-save", session, output: { path: target, bytesMatch: true } });
  assert.equal(one.receipt.receipt.sequence, 1);
  // A restart must not restart the numbering, and must not be able to overwrite the file that exists.
  const two = second.recordSave({ channel: "host:text-save", session, output: { path: target, bytesMatch: true } });
  assert.equal(two.receipt.receipt.sequence, 2);
  const names = fs.readdirSync(path.join(spec.labDir, "receipts", "view-sequence")).filter((name) => name.startsWith("save-")).sort();
  assert.deepEqual(names.map((name) => name.slice(0, 9)), ["save-0001", "save-0002"]);
  const index = JSON.parse(fs.readFileSync(path.join(spec.labDir, "receipts", "view-sequence", "index.json"), "utf8"));
  assert.deepEqual(index.entries.map((entry) => entry.sequence), [1, 2]);
});

test("NEGATIVE a manifest entry that escapes the fixture root is a malformed manifest", () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  for (const bad of ["../../outside.docx", "C:/Windows/win.ini", "/etc/passwd", ""]) {
    const manifest = JSON.parse(fs.readFileSync(spec.manifestPath, "utf8"));
    manifest.fixtures = [{ id: "F-ESCAPE", path: bad, bytes: 4, sha256: sha256(Buffer.from("abcd")), format: "docx" }];
    fs.writeFileSync(spec.manifestPath, JSON.stringify(manifest, null, 2));
    const bridge = createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath });
    assert.throws(
      () => bridge.resolveOpenTarget({ app: "docs", target: "F-ESCAPE" }),
      (error) => error.code === "fixture_manifest_invalid",
      JSON.stringify(bad),
    );
  }
});

test("NEGATIVE a missing bytes/sha256 property is malformed while an explicit null loads", () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const manifest = JSON.parse(fs.readFileSync(spec.manifestPath, "utf8"));
  const entry = manifest.fixtures[0];
  delete entry.bytes;
  fs.writeFileSync(spec.manifestPath, JSON.stringify(manifest, null, 2));
  assert.throws(
    () => createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath }),
    (error) => error.code === "fixture_manifest_invalid",
  );
  entry.bytes = null;
  entry.sha256 = null;
  fs.writeFileSync(spec.manifestPath, JSON.stringify(manifest, null, 2));
  const loaded = createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath });
  assert.equal(loaded.manifest.entries.get(entry.id).identityAvailable, false);
  assert.throws(
    () => loaded.resolveOpenTarget({ app: "docs", target: entry.id }),
    (error) => error.code === "fixture_identity_unavailable",
  );
});

test("NEGATIVE a copy that does not match the validated fixture is refused", () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const bridge = createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath });
  const fixture = { id: "F-DOCX-KITCHEN", path: "p", bytes: DOCX_FIXTURE.length, sha256: sha256(DOCX_FIXTURE) };
  assert.equal(bridge.verifyCopiedFixture({ sourceHash: sha256(DOCX_FIXTURE), sourceBytes: DOCX_FIXTURE.length }, fixture), true);
  assert.throws(
    () => bridge.verifyCopiedFixture({ sourceHash: sha256(Buffer.from("other")), sourceBytes: 5 }, fixture),
    (error) => error.code === "fixture_identity_mismatch" && error.details.stage === "post-copy",
  );
  assert.equal(bridge.verifyCopiedFixture({ sourceHash: null, sourceBytes: 0 }, null), null);
});

test("a scripted client without an observed Orca version is not recorded as an Orca browser", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const engineIdentityFile = writeEngineIdentity(spec.root);
  const server = createLabServer({
    buildsDir: spec.buildsDir, labDir: spec.labDir, fixturesDir: spec.fixtureRoot,
    fixtureManifest: spec.manifestPath, engineIdentity: engineIdentityFile,
    // no orcaVersion: nothing observed `orca --version` for this run
    port: APP_PORT, previewPort: PREVIEW_PORT,
  });
  await waitForFree(APP_PORT);
  await waitForFree(PREVIEW_PORT);
  await server.listen();
  try {
    const opened = await postJson(APP_PORT, "lab:session-open", { app: "markdown", path: "F-MD-KITCHEN" });
    const saved = await postJson(APP_PORT, "host:text-save", { viewId: opened.body.result.viewId, text: "# scripted\n" });
    const receipt = JSON.parse(fs.readFileSync(saved.body.result.bridge.receiptPath, "utf8"));
    assert.equal(receipt.browser.family, "unspecified");
    assert.equal(receipt.browser.orcaVersion, null);
    assert.equal(receipt.browser.orcaVersionSource, "unavailable");
    assert.match(receipt.browser.familySource, /unspecified/);
    assert.equal(receipt.output.declaredSha256, null, "a byte save declares no digest; it must not be restated");
    assert.equal(receipt.output.declaredIndependently, false);
    assert.equal(receipt.engine.host, null);
  } finally {
    await server.close();
  }
});

test("two OVERLAPPING saves on one view each record only their own engine call", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const engine = injectedEngine(spec.labDir, {
    handlers: {
      // The slow call is still in flight when the fast one starts, so the two requests genuinely
      // overlap on one view: attribution must come from the request's own call token, not from a
      // single mutable per-view pointer.
      "xlsx-save": async (input) => {
        const slow = String(input.name ?? "").startsWith("slow");
        await new Promise((resolve) => setTimeout(resolve, slow ? 400 : 20));
        const dir = path.join(spec.labDir, "out", input.viewId);
        fs.mkdirSync(dir, { recursive: true });
        const target = path.join(dir, String(input.name ?? "saved.xlsx"));
        fs.writeFileSync(target, Buffer.from("PK-" + String(input.name ?? "saved.xlsx")));
        return { ok: true, status: "ok", saved: { path: target } };
      },
    },
  });
  await withLab(spec, { engineHandlers: engine }, async ({ post }) => {
    const open = await post("lab:session-open", { app: "sheets", path: "F-XLSX-KITCHEN" });
    const viewId = open.body.result.viewId;
    await post("host:sheets-select-workbook", { viewId, path: null });
    const slowPromise = post("host:sheets-save-edits", { viewId, edits: [{ sheetId: "s1", row: 0, column: 0, writeValue: true, value: "slow" }], name: "slow.xlsx" });
    await new Promise((resolve) => setTimeout(resolve, 60));
    const fastPromise = post("host:sheets-save-edits", { viewId, edits: [{ sheetId: "s1", row: 0, column: 0, writeValue: true, value: "fast" }], name: "fast.xlsx" });
    const [slow, fast] = await Promise.all([slowPromise, fastPromise]);
    assert.equal(slow.body.ok, true, JSON.stringify(slow.body).slice(0, 200));
    assert.equal(fast.body.ok, true, JSON.stringify(fast.body).slice(0, 200));
    const slowReceipt = JSON.parse(fs.readFileSync(slow.body.result.bridge.receiptPath, "utf8"));
    const fastReceipt = JSON.parse(fs.readFileSync(fast.body.result.bridge.receiptPath, "utf8"));
    assert.deepEqual(slowReceipt.engine.operations, ["xlsx-save"], "the slow request records its own engine call exactly once");
    assert.deepEqual(fastReceipt.engine.operations, ["xlsx-save"], "the fast request records its own engine call exactly once");
    assert.equal(path.basename(slowReceipt.output.path), "slow.xlsx");
    assert.equal(path.basename(fastReceipt.output.path), "fast.xlsx");
    assert.equal(slowReceipt.engine.sessionOperations.length, 3, "the session list holds the open and both saves");
    assert.equal(fastReceipt.engine.sessionOperations.length, 3);
    // The discriminating assertions are the two deepEqual checks above: a per-view mutable pointer
    // (the revision-B model) leaves one receipt with zero or two xlsx-save entries when the requests
    // overlap, while the request-scoped call token leaves exactly one in each.
    assert.deepEqual(slowReceipt.engine.sessionOperations, ["xlsx-open", "xlsx-save", "xlsx-save"]);
    assert.deepEqual(fastReceipt.engine.sessionOperations, ["xlsx-open", "xlsx-save", "xlsx-save"]);
    assert.notEqual(slowReceipt.receipt.sequence, fastReceipt.receipt.sequence);
  });
});

test("NEGATIVE a manifest entry without bytes/sha256 loads but is refused by name when requested", () => {
  const spec = makeCase({ fixtures: { "F-DOCX-KITCHEN": { path: "docs/docx-kitchen-sink.docx", bytes: DOCX_FIXTURE } } });
  const manifest = JSON.parse(fs.readFileSync(spec.manifestPath, "utf8"));
  manifest.fixtures.push({ id: "F-LARGE-XLSX", path: "fixtures/large/large-workbook.xlsx", format: "xlsx", bytes: null, sha256: null });
  fs.writeFileSync(spec.manifestPath, JSON.stringify(manifest, null, 2));
  const bridge = createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath });
  assert.equal(bridge.manifest.entries.get("F-LARGE-XLSX").identityAvailable, false);
  assert.equal(bridge.manifest.entries.get("F-DOCX-KITCHEN").identityAvailable, true);
  assert.throws(
    () => bridge.resolveOpenTarget({ app: "sheets", target: "F-LARGE-XLSX" }),
    (error) => error.code === "fixture_identity_unavailable" && error.details.fixtureId === "F-LARGE-XLSX",
  );
});

test("a manifest fixture opens byte-equal and the session names its identity", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  await withLab(spec, {}, async ({ post, server }) => {
    const answer = await post("lab:session-open", { app: "docs", path: "F-DOCX-KITCHEN" });
    assert.equal(answer.status, 200);
    const result = answer.body.result;
    assert.equal(result.fixture.id, "F-DOCX-KITCHEN");
    assert.equal(result.fixture.byteEqualToManifest, true);
    assert.equal(result.fixture.sha256, sha256(DOCX_FIXTURE));
    assert.equal(result.fixture.bytes, DOCX_FIXTURE.length);
    assert.equal(result.fixture.manifestSha256, spec.manifestSha256);
    assert.equal(result.hash, sha256(DOCX_FIXTURE));
    assert.equal(result.bridge.contract, BRIDGE_CONTRACT);
    assert.equal(server.bridge.status().contract, BRIDGE_CONTRACT);
    // A raw path keeps fixture null, so it can never claim a manifest identity.
    const raw = await post("lab:session-open", { app: "docs", path: path.join(spec.fixtureRoot, "docs", "docx-kitchen-sink.docx") });
    assert.equal(raw.body.result.fixture, null);
  });
});

test("the six save paths publish a CONTRACT-v1 receipt (docx and md/html by bytes, pdf/xlsx/pptx through the engine proxy)", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const engine = injectedEngine(spec.labDir);
  await withLab(spec, { engineHandlers: engine }, async ({ post, server }) => {
    const expectations = [
      { app: "docs", fixture: "F-DOCX-KITCHEN", channel: "host:docs-save", format: "docx", operationId: "open-edit-text-save-reopen", body: (view) => ({ path: null, dataBase64: Buffer.from("docx-edited-bytes").toString("base64") }) },
      { app: "markdown", fixture: "F-MD-KITCHEN", channel: "host:text-save", format: "md", operationId: "edit-source-save-reopen", body: () => ({ text: "# edited\n\n| a | b |\n| - | - |\n" }) },
      { app: "html", fixture: "F-HTML-KITCHEN", channel: "host:text-save", format: "html", operationId: "edit-source-save-reopen-isolated-preview", body: () => ({ text: "<html><body><p id=\"edit-me\">edited</p></body></html>" }) },
      { app: "pdf", fixture: "F-PDF-KITCHEN", channel: "host:pdf-save", format: "pdf", operationId: "replace-text-and-image-save-reopen", body: (view) => ({ path: null, edits: [] }) },
      { app: "sheets", fixture: "F-XLSX-KITCHEN", channel: "host:sheets-save-edits", format: "xlsx", operationId: "open-edit-cell-recalculate-save-reopen", body: () => ({ edits: [], name: "saved.xlsx" }) },
      { app: "slides", fixture: "F-PPTX-KITCHEN", channel: "host:slides-save", format: "pptx", operationId: "edit-text-image-shape-save-reopen", body: () => ({}) },
    ];
    for (const expectation of expectations) {
      const open = await post("lab:session-open", { app: expectation.app, path: expectation.fixture });
      assert.equal(open.status, 200, expectation.format + " open");
      const viewId = open.body.result.viewId;
      if (expectation.app === "slides") {
        const opened = await post("host:slides-open", { viewId, path: null });
        assert.equal(opened.status, 200, "slides open");
        assert.equal(opened.body.result.viewId, viewId);
      }
      const body = expectation.body(viewId);
      if (expectation.channel === "host:pdf-save" || expectation.app === "docs") {
        body.path = body.path ?? path.join(spec.labDir, "views", viewId, "input", path.basename(open.body.result.path));
      }
      const save = await post(expectation.channel, { viewId, ...body, bridge: { contract: BRIDGE_CONTRACT, operationId: expectation.operationId, client: { family: "orca", userAgent: UA } } });
      assert.equal(save.status, 200, expectation.format + " save status: " + JSON.stringify(save.body));
      assert.equal(save.body.ok, true, expectation.format + " save ok");
      assert.ok(save.body.result.bridge, expectation.format + " response carries the bridge stamp");
      assert.equal(save.body.result.bridge.contract, BRIDGE_CONTRACT);
      assert.equal(save.body.result.bridge.operationId, expectation.operationId);

      const receiptPath = save.body.result.bridge.receiptPath;
      assert.equal(fs.existsSync(receiptPath), true, expectation.format + " receipt exists");
      const receipt = JSON.parse(fs.readFileSync(receiptPath, "utf8"));
      assert.equal(receipt.receipt.contract, BRIDGE_CONTRACT);
      assert.equal(receipt.receipt.format, expectation.format);
      assert.equal(receipt.receipt.operationId, expectation.operationId);
      assert.equal(receipt.receipt.channel, expectation.channel);
      assert.equal(receipt.receipt.viewId, viewId);
      assert.equal(receipt.input.fixtureId, expectation.fixture);
      assert.equal(receipt.input.sha256, sha256(ALL_FIXTURES[expectation.fixture].bytes));
      assert.equal(receipt.input.byteEqualToManifest, true);
      assert.equal(receipt.receipt.requestDigest.length, 64);
      assert.equal(receipt.digest.value, receiptDigest(receipt), expectation.format + " receipt digest is canonical");
      assert.equal(receipt.browser.family, "orca");
      assert.equal(receipt.browser.orcaVersion, "1.4.209");
      assert.equal(receipt.browser.chromiumVersion, "150.0.7871.250");
      assert.equal(receipt.browser.declaredMatchesUserAgent, true);
      // The receipt's output digest is recomputed from the bytes on disk, not echoed.
      const onDisk = fs.readFileSync(receipt.output.path);
      assert.equal(sha256(onDisk), receipt.output.sha256);
      assert.equal(onDisk.length, receipt.output.bytes);
      assert.equal(receipt.output.verified, true);
      // Engine identity and attribution: byte paths record no engine call, engine paths do.
      assert.equal(receipt.engine.name, expectation.app === "docs" ? "@genoffice/docs" : receipt.engine.name);
      if (["pdf", "xlsx", "pptx"].includes(expectation.format)) {
        assert.equal(receipt.engine.runtime, "engine-host-http");
        assert.equal(receipt.engine.host, null, "an injected (in-process) engine records no host URL");
        assert.equal(receipt.engine.operations.length, 1, expectation.format + " attributes exactly its own save call");
        assert.equal(receipt.engine.operations[0], expectation.format === "pdf" ? "pdf-save" : expectation.format === "xlsx" ? "xlsx-save" : "pptx-save");
      } else {
        assert.deepEqual(receipt.engine.operations, [], expectation.format + " performs no engine call");
        assert.equal(receipt.engine.runtime, "browser-renderer");
        assert.equal(receipt.engine.host, null, "a save with no engine call records no host");
      }
      // The durable index agrees with the receipt, and the live log carries the same op.
      const index = JSON.parse(fs.readFileSync(path.join(spec.labDir, "receipts", viewId, "index.json"), "utf8"));
      assert.equal(index.entries.length, 1);
      assert.equal(index.entries[0].receiptPath, receiptPath);
      assert.equal(index.entries[0].outputSha256, receipt.output.sha256);
      assert.ok(server.records().some((entry) => entry.op === receipt.receipt.op && entry.view === viewId));
    }
    void server;
  });
});

test("NEGATIVE a declared bridge block without a contract string or with a foreign one is refused before any write", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  await withLab(spec, {}, async ({ post }) => {
    const open = await post("lab:session-open", { app: "markdown", path: "F-MD-KITCHEN" });
    const viewId = open.body.result.viewId;
    const before = fs.readFileSync(open.body.result.workingPath);
    for (const [bridge, code, status] of [
      [{}, "bridge_contract_required", 400],
      [{ contract: "" }, "bridge_contract_required", 400],
      [{ contract: "uniwork-office-lab-bridge@2" }, "bridge_contract_unsupported", 400],
      [{ contract: "someone-elses-bridge@1" }, "bridge_contract_unsupported", 400],
      [{ contract: BRIDGE_CONTRACT, operationId: "open-edit-text-save-reopen" }, "bridge_operation_mismatch", 400],
    ]) {
      const answer = await post("host:text-save", { viewId, text: "# refused\n", bridge });
      assert.equal(answer.status, status, JSON.stringify(bridge));
      assert.equal(answer.body.error, code, JSON.stringify(bridge));
    }
    const after = fs.readFileSync(open.body.result.workingPath);
    assert.equal(sha256(after), sha256(before), "a refused declared envelope never writes");
    const receiptsDir = path.join(spec.labDir, "receipts", viewId);
    assert.equal(fs.existsSync(receiptsDir) ? fs.readdirSync(receiptsDir).length : 0, 0, "a refused save leaves no receipt");
  });
});

test("NEGATIVE a mismatched output hash writes only a refusal receipt carrying both digests", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const lie = "0".repeat(64);
  const engine = injectedEngine(spec.labDir, { pdfDeclaredSha256: lie });
  await withLab(spec, { engineHandlers: engine }, async ({ post }) => {
    const open = await post("lab:session-open", { app: "pdf", path: "F-PDF-KITCHEN" });
    const viewId = open.body.result.viewId;
    const save = await post("host:pdf-save", {
      viewId,
      path: open.body.result.path,
      edits: [],
      bridge: { contract: BRIDGE_CONTRACT, operationId: "replace-text-and-image-save-reopen" },
    });
    assert.equal(save.body.ok, false, "a mismatch is not answered as a save");
    assert.equal(save.body.error, "output_hash_mismatch");
    const dir = path.join(spec.labDir, "receipts", viewId);
    const names = fs.readdirSync(dir);
    assert.equal(names.some((name) => name.startsWith("save-")), false, "no save receipt for a mismatch");
    const refused = names.filter((name) => name.startsWith("refused-"));
    assert.equal(refused.length, 1);
    const receipt = JSON.parse(fs.readFileSync(path.join(dir, refused[0]), "utf8"));
    assert.equal(receipt.receipt.ok, false);
    assert.equal(receipt.receipt.refusal.code, "output_hash_mismatch");
    assert.equal(receipt.receipt.refusal.details.declaredSha256, lie);
    assert.equal(receipt.receipt.refusal.details.observedSha256, sha256(Buffer.from("%PDF-1.7\nsaved-by-injected-engine\n")));
    assert.equal(receipt.output, undefined);
    assert.equal(receipt.digest.value, receiptDigest(receipt));
    const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
    assert.deepEqual(index.entries.map((entry) => entry.kind), ["refused"]);
    assert.equal(index.entries[0].code, "output_hash_mismatch");
  });
});

test("NEGATIVE a byte save whose written bytes did not survive is refused (bytesMatch false)", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  const bridge = createBridge({ labDir: spec.labDir, manifestPath: spec.manifestPath, fixtureRoot: spec.root, now: () => "2026-09-25T00:00:00.000Z" });
  const session = { viewId: "view-synthetic", app: "markdown", sourceReal: path.join(spec.root, "docs", "md-kitchen-sink.md"), sourceName: "md-kitchen-sink.md", sourceBytes: MD_FIXTURE.length, sourceHash: sha256(MD_FIXTURE) };
  bridge.attachFixture(session, { id: "F-MD-KITCHEN", manifestPath: spec.manifestPath, manifestSha256: spec.manifestSha256, path: session.sourceReal, bytes: MD_FIXTURE.length, sha256: sha256(MD_FIXTURE), byteEqualToManifest: true });
  const target = path.join(spec.labDir, "views", "view-synthetic", "input", "md-kitchen-sink.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "# real bytes on disk\n");
  assert.throws(
    () => bridge.recordSave({ channel: "host:text-save", session, output: { path: target, bytesMatch: false, declaredSha256: sha256(fs.readFileSync(target)) } }),
    (error) => error.code === "output_hash_mismatch",
  );
  const dir = path.join(spec.labDir, "receipts", "view-synthetic");
  const names = fs.readdirSync(dir);
  assert.equal(names.filter((name) => name.startsWith("save-")).length, 0);
  assert.equal(names.filter((name) => name.startsWith("refused-")).length, 1);
  const receipt = JSON.parse(fs.readFileSync(path.join(dir, names.find((n) => n.startsWith("refused-"))), "utf8"));
  assert.equal(receipt.receipt.refusal.details.bytesMatch, false);
  assert.equal(receipt.receipt.refusal.details.observedSha256, sha256(Buffer.from("# real bytes on disk\n")));
});

test("two saves of one view produce two ordered receipts, and the index lists both", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  await withLab(spec, {}, async ({ post }) => {
    const open = await post("lab:session-open", { app: "html", path: "F-HTML-KITCHEN" });
    const viewId = open.body.result.viewId;
    const first = await post("host:text-save", { viewId, text: "<p>one</p>" });
    const second = await post("host:text-save", { viewId, text: "<p>two</p>" });
    assert.equal(first.body.result.bridge.outputSha256, sha256(Buffer.from("<p>one</p>")));
    assert.equal(second.body.result.bridge.outputSha256, sha256(Buffer.from("<p>two</p>")));
    const dir = path.join(spec.labDir, "receipts", viewId);
    const saves = fs.readdirSync(dir).filter((name) => name.startsWith("save-")).sort();
    assert.equal(saves.length, 2);
    assert.equal(saves[0].startsWith("save-0001-"), true, saves[0]);
    assert.equal(saves[1].startsWith("save-0002-"), true, saves[1]);
    const index = JSON.parse(fs.readFileSync(path.join(dir, "index.json"), "utf8"));
    assert.equal(index.entries.length, 2);
    assert.deepEqual(index.entries.map((entry) => entry.sequence), [1, 2]);
    assert.notEqual(first.body.result.bridge.receiptDigest, second.body.result.bridge.receiptDigest);
  });
});

test("the declared and observed browser identity are kept apart when they disagree", async () => {
  const spec = makeCase({ fixtures: ALL_FIXTURES });
  await withLab(spec, {}, async ({ post }) => {
    const open = await post("lab:session-open", { app: "markdown", path: "F-MD-KITCHEN" });
    const save = await post("host:text-save", {
      viewId: open.body.result.viewId,
      text: "# lied about the client\n",
      bridge: { contract: BRIDGE_CONTRACT, operationId: "edit-source-save-reopen", client: { family: "orca", userAgent: "Mozilla/5.0 Chrome/1.0.0.0" } },
    });
    const receipt = JSON.parse(fs.readFileSync(save.body.result.bridge.receiptPath, "utf8"));
    assert.equal(receipt.browser.userAgent, UA);
    assert.equal(receipt.browser.chromiumVersion, "150.0.7871.250");
    assert.equal(receipt.browser.declared.userAgent, "Mozilla/5.0 Chrome/1.0.0.0");
    assert.equal(receipt.browser.declaredMatchesUserAgent, false);
  });
});

test("the integrated lab host wires the bridge and both slice extensions", () => {
  // Replaces the slice-only "replica keeps every other lab source byte-identical to M" check, whose apply
  // receipts live in the core-protocol slice, not in M (Advisor g118 integration).
  const server = fs.readFileSync(LAB_DIR_MODULE, "utf8");
  assert.match(server, /from '\.\/lab-bridge\.mjs'/, "lab-server.mjs must import the bridge module");
  assert.match(server, /'host:slides-edit-transform'/, "the core-docx-pptx transform channel must be registered");
  assert.match(server, /'host:pdf-page-image-png'/, "the core-xlsx-pdf page image channel must be registered");
  assert.equal(fs.existsSync(path.join(path.dirname(LAB_DIR_MODULE), "lab-page-image-png.mjs")), true);
});

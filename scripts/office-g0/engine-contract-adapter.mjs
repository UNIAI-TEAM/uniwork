// DOC-004 (UNI-668) - REAL-ADAPTER fault harness for the engine contract.
//
// engine-contract.mjs models the boundary with injected fakes and says so in
// EVIDENCE_REGISTRY. This file is the task-4.4 counterpart: it drives the REAL
// DOC-003 spike engine host (UNI-667) over its loopback HTTP transport and records
// what the transport actually answered - the route, the HTTP status, the adapter
// code, the contract error that code maps to, and the artifact bytes it wrote.
//
// Node 22 builtins only: no product import, no third-party package, the same rule
// as the boundary harness. It does not boot the host; the operator boots it and
// passes --base-url. That keeps a slow native engine out of a unit test while the
// run itself is still a real engine. A case whose host is unreachable, or whose
// fixture is absent, is reported `unavailable` with the reason and fails the run
// unless --allow-unavailable is passed: missing proof is stated, never
// substituted, and a model pass is never promoted to real-engine evidence.
//
//   # 1. prepare a lab this harness owns (copies the DOC-003 fixtures into it)
//   node scripts/office-g0/engine-contract-adapter.mjs --prepare \
//        --lab <work>/.office-g0-adapter-lab --fixtures <spike>/lab/fixtures
//   # 2. boot the real host against that lab
//   <source>/node_modules/.bin/tsx e2e/office-g0/engine-host.mts \
//        --source <source> --lab <work>/.office-g0-adapter-lab \
//        --prebundle <spike>/lab/engine/pptx-ops.mjs --port 5392
//   # 3. run the fault cases
//   node scripts/office-g0/engine-contract-adapter.mjs \
//        --base-url http://127.0.0.1:5392 --lab <work>/.office-g0-adapter-lab --print
//
// Exit code 0 only when every available case matches its oracle.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { pathToFileURL, fileURLToPath } from "node:url";

export const ADAPTER_CONTRACT_VERSION = "uniwork-office-engine-contract/1";
/** Transport this harness speaks. Recorded so an evidence reader cannot guess. */
export const ADAPTER_TRANSPORT = "loopback-http-post";

/**
 * Adapter transport codes -> the contract's error vocabulary.
 *
 * The host has its OWN transport codes (no_route, bad_view_id, ...). A caller
 * must be able to branch on a CONTRACT code, so every adapter code the harness
 * has observed is mapped here explicitly. A caller/schema fault becomes a
 * ContractViolation (field_path + never retryable); an engine outcome becomes a
 * BoundaryError code from ERROR_CODES. An adapter code with no mapping is NOT
 * waved through: classify() reports it as an unmapped caller fault so the case
 * fails instead of pretending the contract covers it.
 */
export const ADAPTER_ERROR_MAP = {
  method_not_allowed: { code: null, error_class: "contract_violation", retryable: false, field_path: "transport.method" },
  bad_json: { code: null, error_class: "contract_violation", retryable: false, field_path: "transport.body" },
  bad_view_id: { code: null, error_class: "contract_violation", retryable: false, field_path: "transport.viewId" },
  bad_input: { code: null, error_class: "contract_violation", retryable: false, field_path: "transport.input" },
  bad_path: { code: null, error_class: "contract_violation", retryable: false, field_path: "transport.path" },
  outside_lab: { code: "not_found", error_class: "missing", retryable: false, field_path: null },
  not_found: { code: "not_found", error_class: "missing", retryable: false, field_path: null },
  no_route: { code: "unsupported_operation", error_class: "incompatible", retryable: false, field_path: null },
  host_closed: { code: "engine_crashed", error_class: "engine", retryable: true, field_path: null },
  session_exists: { code: null, error_class: "contract_violation", retryable: false, field_path: "transport.viewId" },
  no_session: { code: "not_found", error_class: "missing", retryable: false, field_path: null },
  engine_error: { code: "engine_result_invalid", error_class: "engine", retryable: true, field_path: null },
  engine_result_invalid: { code: "engine_result_invalid", error_class: "engine", retryable: true, field_path: null },
  engine_timeout: { code: "engine_timeout", error_class: "engine", retryable: true, field_path: null },
};

/** Client-side failures this harness raises before any transport answer exists. */
export const ADAPTER_CLIENT_FAILURE = {
  unreachable: { code: "engine_crashed", error_class: "engine", retryable: true, field_path: null },
  client_timeout: { code: "engine_timeout", error_class: "engine", retryable: true, field_path: null },
};

/** Stable JSON (keys sorted), so a digest of oracle rows never depends on key order. */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

/**
 * A STABLE digest of the case ORACLES themselves (id + expect), recomputed from
 * the frozen case list. The evidence FILE digest cannot be pinned: buildAdapterEvidence
 * embeds `generated_at` and an absolute lab path, so any re-run changes it even when
 * all 11 oracles still hold. This digest is what the registry and doc §12.3 cite:
 * it moves only when an oracle moves.
 */
export function adapterOracleDigest(cases = ADAPTER_FAULT_CASES) {
  return sha256Bytes(Buffer.from(canonicalJson(cases.map((c) => ({ id: c.id, expect: c.expect }))), "utf8"));
}

/** The DOC-003 fixtures the fault cases need, by the names the spike lab uses. */
export const REQUIRED_FIXTURES = ["g0-kitchen-sink.docx", "g0-text.pdf", "g0-slides.pptx"];

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

/** One HTTP call. Never throws: a transport failure is an observed result. */
export function httpCall({ baseUrl, route, body, method = "POST", timeoutMs = 30000 }) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(route, baseUrl);
    } catch (error) {
      resolve({ reachable: false, transport_error: "bad_base_url", transport_status: null, parsed: null, parse_error: null, body_bytes: 0 });
      return;
    }
    const payload = body === undefined || body === null
      ? null
      : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
    const headers = payload === null
      ? {}
      : { "content-type": "application/json", "content-length": String(payload.length) };
    const request = http.request(
      { protocol: url.protocol, hostname: url.hostname, port: url.port, path: url.pathname + url.search, method, headers },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed = null;
          let parse_error = null;
          try {
            parsed = text.length === 0 ? null : JSON.parse(text);
          } catch (error) {
            parse_error = error.message;
          }
          resolve({
            reachable: true,
            transport_status: response.statusCode,
            parsed,
            parse_error,
            body_bytes: Buffer.byteLength(text),
          });
        });
      },
    );
    request.on("error", (error) => resolve({
      reachable: false,
      transport_error: error.code ?? error.message,
      transport_status: null,
      parsed: null,
      parse_error: null,
      body_bytes: 0,
    }));
    request.setTimeout(timeoutMs, () => { request.destroy(new Error("client_timeout")); });
    if (payload !== null) request.write(payload);
    request.end();
  });
}

/**
 * Reduce one transport answer to comparable, literal facts. `ok` is true only
 * when the HTTP status is below 400 AND the envelope says ok:true, so a host that
 * returned 200 with ok:false is a refusal, not a success.
 */
export function classify(response) {
  if (response.reachable !== true) {
    const clientCode = response.transport_error ?? "unreachable";
    const mapped = ADAPTER_CLIENT_FAILURE[clientCode] ?? ADAPTER_CLIENT_FAILURE.unreachable;
    return {
      reachable: false,
      transport_status: null,
      adapter_code: clientCode,
      ok: false,
      result: null,
      mapped_code: mapped.code,
      mapped_class: mapped.error_class,
      retryable: mapped.retryable,
      field_path: mapped.field_path,
    };
  }
  const envelope = response.parsed;
  const envelopeOk = envelope !== null && typeof envelope === "object" && envelope.ok === true;
  const ok = response.transport_status < 400 && envelopeOk;
  const adapterCode = ok
    ? null
    : (envelope && typeof envelope.code === "string"
      ? envelope.code
      : (response.parse_error ? "bad_json" : "unparsed_error"));
  const mapped = ok
    ? null
    : ADAPTER_ERROR_MAP[adapterCode] ?? { code: null, error_class: "contract_violation", retryable: false, field_path: "transport.unmapped_code" };
  return {
    reachable: true,
    transport_status: response.transport_status,
    adapter_code: adapterCode,
    ok,
    result: ok ? (envelope.result ?? null) : null,
    mapped_code: mapped ? mapped.code : null,
    mapped_class: mapped ? mapped.error_class : null,
    retryable: mapped ? mapped.retryable : null,
    field_path: mapped ? mapped.field_path : null,
  };
}

/** A thin client: every probe returns a classified observation, never a throw. */
export function createAdapterClient({ baseUrl, timeoutMs = 30000 } = {}) {
  return {
    baseUrl,
    async post(route, body) { return classify(await httpCall({ baseUrl, route, body, method: "POST", timeoutMs })); },
    async get(route) { return classify(await httpCall({ baseUrl, route, body: null, method: "GET", timeoutMs })); },
    async postRaw(route, raw) { return classify(await httpCall({ baseUrl, route, body: raw, method: "POST", timeoutMs })); },
  };
}

/** Refuse a write destination outside the allowed root. Nothing is written first. */
export function assertInside(allowedRoot, target) {
  const root = path.resolve(allowedRoot);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("refusing to write outside " + root + ": " + resolved);
  }
  return resolved;
}

/**
 * Copy the DOC-003 fixtures into a lab this harness owns. The spike lab stays
 * READ ONLY: this reads its fixtures and writes only inside `labDir`, which must
 * live under `allowedRoot`. Returns the fixture names actually placed.
 */
export function prepareLab({ labDir, fixturesDir, allowedRoot, fixtures = REQUIRED_FIXTURES }) {
  const target = assertInside(allowedRoot, path.join(labDir, "fixtures"));
  fs.mkdirSync(target, { recursive: true });
  const placed = [];
  for (const name of fixtures) {
    const from = path.join(fixturesDir, name);
    if (!fs.existsSync(from)) continue;
    const to = path.join(target, name);
    fs.copyFileSync(from, to);
    placed.push({ name, bytes: fs.statSync(to).size, sha256: sha256Bytes(fs.readFileSync(to)) });
  }
  return { labDir: path.resolve(labDir), fixturesDir: path.resolve(target), placed };
}

const DOCX_FIXTURE = "g0-kitchen-sink.docx";
const PDF_FIXTURE = "g0-text.pdf";
const PPTX_FIXTURE = "g0-slides.pptx";
const EDIT_VIEW = "uni668-adapter-r1";

export const ADAPTER_FAULT_CASES = [
  {
    id: "adapter-unreachable-host-maps-to-engine-crashed",
    requirement: "a host that is not listening is an engine failure, never a silent success",
    expect: { reachable: false, ok: false, mapped_code: "engine_crashed", mapped_class: "engine", retryable: true },
    run: async () => {
      const closed = createAdapterClient({ baseUrl: "http://127.0.0.1:1", timeoutMs: 4000 });
      return closed.post("/engine/ping", {});
    },
  },
  {
    id: "adapter-method-not-allowed-is-a-caller-fault",
    requirement: "a non-POST call is refused as a caller fault, not answered",
    expect: { reachable: true, transport_status: 405, adapter_code: "method_not_allowed", ok: false, mapped_class: "contract_violation", field_path: "transport.method" },
    run: (client) => client.get("/engine/ping"),
  },
  {
    id: "adapter-bad-json-is-a-caller-fault",
    requirement: "a body that is not JSON is refused before any route runs",
    expect: { reachable: true, transport_status: 400, adapter_code: "bad_json", ok: false, mapped_class: "contract_violation", field_path: "transport.body" },
    run: (client) => client.postRaw("/engine/ping", "not-json"),
  },
  {
    id: "adapter-unknown-route-is-a-typed-refusal",
    requirement: "an operation the host does not serve refuses by a name a caller can branch on",
    expect: { reachable: true, adapter_code: "no_route", ok: false, mapped_code: "unsupported_operation", mapped_class: "incompatible", retryable: false },
    run: (client) => client.post("/engine/uni668-no-such-route", {}),
  },
  {
    id: "adapter-view-traversal-refused-before-work",
    requirement: "a viewId that is not one safe path segment is refused, and no directory escapes the lab",
    expect: { reachable: true, adapter_code: "bad_view_id", ok: false, mapped_class: "contract_violation", escaped_dir_created: false },
    run: async (client, ctx) => {
      const observed = await client.post("/engine/docx-edit", { viewId: "../uni668-escape", path: ctx.fixturePath(DOCX_FIXTURE), text: "x" });
      return { ...observed, escaped_dir_created: fs.existsSync(path.join(path.dirname(ctx.labDir), "uni668-escape")) };
    },
  },
  {
    id: "adapter-outside-lab-path-refused",
    requirement: "a document path outside the lab is refused, never read",
    expect: { reachable: true, ok: false, refused_adapter_code: "outside_lab", mapped_class: "missing" },
    run: async (client, ctx) => {
      const outside = path.join(ctx.allowedRoot, "package.json");
      const observed = await client.post("/engine/docx-parse", { path: outside });
      return { ...observed, refused_adapter_code: observed.adapter_code };
    },
  },
  {
    id: "adapter-malformed-engine-input-is-typed",
    requirement: "real engine bytes it cannot parse produce a typed refusal, never a silent success",
    expect: { reachable: true, adapter_code: "engine_error", ok: false, mapped_code: "engine_result_invalid", mapped_class: "engine", retryable: true },
    run: (client, ctx) => client.post("/engine/docx-parse", { path: ctx.fixturePath(PDF_FIXTURE) }),
  },
  {
    id: "adapter-missing-required-input-is-refused",
    requirement: "a routed call missing a required field is refused as a caller fault",
    expect: { reachable: true, adapter_code: "bad_input", ok: false, mapped_class: "contract_violation", field_path: "transport.input" },
    run: (client, ctx) => client.post("/engine/docx-edit", { viewId: EDIT_VIEW, path: ctx.fixturePath(DOCX_FIXTURE) }),
  },
  {
    id: "adapter-real-docx-edit-roundtrip-persists",
    requirement: "a real docx edit persists the replacement text and retains every other original block",
    expect: {
      reachable: true, ok: true, edit_persisted: true, all_originals_retained: true,
      persisted_hash_matches_reported: true, output_bytes_gt_0: true, persisted_bytes_gt_0: true,
    },
    run: async (client, ctx) => {
      const observed = await client.post("/engine/docx-edit", {
        viewId: EDIT_VIEW, path: ctx.fixturePath(DOCX_FIXTURE), text: "UNI-668 ADAPTER EDIT", name: "uni668-edit.docx",
      });
      if (!observed.ok) return observed;
      const persistedPath = path.join(ctx.labDir, "out", EDIT_VIEW, "uni668-edit.docx");
      const onDisk = fs.existsSync(persistedPath) ? fs.readFileSync(persistedPath) : null;
      return {
        ...observed,
        edit_persisted: observed.result.editPersisted === true,
        all_originals_retained: observed.result.allOriginalsRetained === true,
        persisted_hash_matches_reported: onDisk ? sha256Bytes(onDisk) === observed.result.persistedHash : false,
        output_bytes_gt_0: observed.result.outBytes > 0,
        persisted_bytes_gt_0: onDisk ? onDisk.length > 0 : false,
        artifact: persistedPath,
      };
    },
  },
  {
    id: "adapter-real-pdf-text-read-returns-fixture-text",
    requirement: "the real PDF engine reads the fixture text through the adapter",
    expect: { reachable: true, ok: true, page_count: 2, text_contains_fixture_line: true },
    run: async (client, ctx) => {
      const observed = await client.post("/engine/pdf-text-read", { path: ctx.fixturePath(PDF_FIXTURE) });
      if (!observed.ok) return observed;
      return {
        ...observed,
        page_count: observed.result.pageCount,
        text_contains_fixture_line: typeof observed.result.text === "string" && observed.result.text.includes("DOC-003 lab fixture"),
      };
    },
  },
  {
    id: "adapter-real-pptx-open-and-close-cycle",
    requirement: "the real PPTX engine opens a deck and the host releases the session",
    expect: { reachable: true, ok: true, slide_count: 2, session_closed: true },
    run: async (client, ctx) => {
      // Re-runnable: a session left by a previous run is released first, so this
      // case measures the open/close cycle and not the host's session bookkeeping.
      await client.post("/engine/session-close", { viewId: EDIT_VIEW });
      const opened = await client.post("/engine/pptx-open", { viewId: EDIT_VIEW, path: ctx.fixturePath(PPTX_FIXTURE) });
      if (!opened.ok) return opened;
      const closed = await client.post("/engine/session-close", { viewId: EDIT_VIEW });
      return { ...opened, slide_count: opened.result.count, session_closed: closed.ok === true && closed.result.closed === true };
    },
  },
];

/** Compare only the keys the case declares, exactly as the boundary harness does. */
export function runAdapterCase(testCase, client, ctx) {
  return Promise.resolve()
    .then(() => testCase.run(client, ctx))
    .then((observedRaw) => {
      const observed = {};
      for (const key of Object.keys(testCase.expect)) observed[key] = observedRaw[key] ?? null;
      const mismatches = Object.keys(testCase.expect).filter(
        (key) => JSON.stringify(testCase.expect[key]) !== JSON.stringify(observed[key]),
      );
      return {
        id: testCase.id,
        requirement: testCase.requirement,
        expect: testCase.expect,
        observed,
        mismatches,
        pass: mismatches.length === 0,
        evidence_kind: "real_engine_evidence",
      };
    })
    .catch((error) => ({
      id: testCase.id,
      requirement: testCase.requirement,
      expect: testCase.expect,
      observed: { harness_error: String(error && error.message ? error.message : error) },
      mismatches: ["harness_error"],
      pass: false,
      evidence_kind: "real_engine_evidence",
    }));
}

export const ADAPTER_EVIDENCE = {
  kind: "real_engine_evidence",
  engine: "DOC-003 spike engine host (UNI-667) e2e/office-g0/engine-host.mts",
  upstream_pin: "09485f884dc845cf3bf27fb7edfe489f9d457aad",
  what_it_proves:
    "the real DOC-003 engine host, driven over its loopback transport, refuses the faulty calls this contract names and completes a real docx edit and PDF read",
  what_it_does_not_prove:
    "browser rendering, the Go service, product auth/ACL/tenant isolation, object storage, packaging, or the six-browser DOC-003 flows (UNI-667 owns those)",
};

/** The one case that EXPECTS an unreachable host. Every other case treats an
 * unreachable host as missing proof (unavailable), not as an oracle failure. */
const UNREACHABLE_CASE_ID = "adapter-unreachable-host-maps-to-engine-crashed";

export async function runAllAdapterCases({ baseUrl, labDir, allowedRoot, timeoutMs = 30000 }) {
  const ctx = {
    labDir: path.resolve(labDir),
    allowedRoot: path.resolve(allowedRoot),
    fixturePath: (name) => path.join(path.resolve(labDir), "fixtures", name),
  };
  const client = createAdapterClient({ baseUrl, timeoutMs });
  const results = [];
  for (const testCase of ADAPTER_FAULT_CASES) {
    const needsFixture = /docx|pdf|pptx/.test(testCase.id);
    if (needsFixture && !fs.existsSync(path.join(ctx.labDir, "fixtures"))) {
      results.push({
        id: testCase.id,
        requirement: testCase.requirement,
        expect: testCase.expect,
        observed: { unavailable: "lab fixtures were never prepared; run --prepare first" },
        mismatches: ["unavailable"],
        pass: false,
        unavailable: true,
        evidence_kind: "real_engine_evidence",
      });
      continue;
    }
    const result = await runAdapterCase(testCase, client, ctx);
    // A host that is not listening is MISSING PROOF, not a failed oracle - except
    // for the one case whose whole point is an unreachable host. Without this, a
    // skipped boot would read as ten case failures and hide that nothing ran.
    const hostUnreachable = result.observed && result.observed.reachable === false;
    if (!result.pass && hostUnreachable && testCase.id !== UNREACHABLE_CASE_ID) {
      result.unavailable = true;
      result.observed = { ...result.observed, unavailable: "host unreachable at " + baseUrl + "; boot the DOC-003 host to run this case" };
    }
    results.push(result);
  }
  const passed = results.filter((r) => r.pass).length;
  const unavailable = results.filter((r) => r.unavailable === true).length;
  // `failed` is a real oracle MISMATCH on a case that COULD run. An unavailable
  // case is not a failure; it is proof that was not collected.
  const failed = results.filter((r) => !r.pass && r.unavailable !== true).length;
  return {
    total: results.length,
    passed,
    failed,
    unavailable,
    results,
    evidence: ADAPTER_EVIDENCE,
  };
}

export function buildAdapterEvidence(report, { baseUrl, labDir }) {
  return {
    issue: "UNI-668",
    parent_issue: "UNI-656",
    task: "DOC-004 engine/editor/storage contract - real DOC-003 adapter fault evidence (task 4.4)",
    contract_version: ADAPTER_CONTRACT_VERSION,
    transport: ADAPTER_TRANSPORT,
    base_url: baseUrl,
    lab: path.resolve(labDir),
    evidence_kind: "real_engine_evidence",
    generated_at: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    total: report.total,
    passed: report.passed,
    failed: report.failed,
    unavailable: report.unavailable,
    // The STABLE digest the registry and doc §12.3 cite. It covers the case
    // oracles, not this file, because this file's own bytes move with
    // generated_at and the absolute lab path on every run.
    oracle_digest: adapterOracleDigest(),
    adapter_error_map: ADAPTER_ERROR_MAP,
    evidence: ADAPTER_EVIDENCE,
    cases: report.results.map((r) => ({
      id: r.id, pass: r.pass, unavailable: r.unavailable === true,
      expect: r.expect, observed: r.observed, mismatches: r.mismatches,
    })),
  };
}

export async function main(argv) {
  const argOf = (name, fallback = null) => {
    const index = argv.indexOf("--" + name);
    return index === -1 ? fallback : argv[index + 1] ?? fallback;
  };
  const here = path.dirname(fileURLToPath(import.meta.url));
  const allowedRoot = path.resolve(argOf("allow-root", path.join(here, "..", "..")));
  const labDir = argOf("lab", path.join(allowedRoot, ".office-g0-adapter-lab"));
  const fixturesDir = argOf("fixtures", null);
  const baseUrl = argOf("base-url", "http://127.0.0.1:5392");
  const allowUnavailable = argv.includes("--allow-unavailable");
  const print = argv.includes("--print");
  const outPath = argOf("out", null);

  if (argv.includes("--prepare")) {
    if (!fixturesDir) {
      process.stderr.write("--prepare needs --fixtures <dir>\n");
      return 2;
    }
    const prepared = prepareLab({ labDir, fixturesDir, allowedRoot });
    process.stdout.write("prepared lab " + prepared.labDir + " with " + prepared.placed.length + " fixture(s)\n");
    return 0;
  }

  const report = await runAllAdapterCases({ baseUrl, labDir, allowedRoot });
  if (print) {
    for (const result of report.results) {
      const status = result.pass ? "PASS" : (result.unavailable ? "UNAVAIL" : "FAIL");
      process.stdout.write(status.padEnd(8) + result.id
        + (result.pass ? "" : "  mismatches=" + JSON.stringify(result.mismatches))
        + (result.pass ? "" : "  observed=" + JSON.stringify(result.observed))
        + "\n");
    }
  }
  const evidence = buildAdapterEvidence(report, { baseUrl, labDir });
  if (outPath) {
    assertInside(allowedRoot, outPath);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2) + "\n");
    process.stdout.write("wrote " + path.resolve(outPath) + "\n");
  }
  process.stdout.write("engine-contract-adapter: " + report.passed + "/" + report.total
    + " cases match their oracle (real_engine_evidence), failed=" + report.failed
    + ", unavailable=" + report.unavailable + "\n");
  if (report.failed > 0) return 1;
  // Every case that could run matched its oracle. Unavailable cases are proof that
  // was NOT collected, so they need --allow-unavailable to exit 0; without the flag
  // an incomplete run is a non-zero result, never a silent pass.
  if (report.unavailable > 0 && !allowUnavailable) return 1;
  return 0;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
}

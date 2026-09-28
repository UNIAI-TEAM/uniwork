// G2-07a integration evidence (UNI-690). Node 22, no dependencies: it pins the
// three-way contract identity (Go <-> TS <-> the evidence doc), checks that
// every format row in docs/office/g1-g2-evidence.md names a real G0 fixture
// whose sha256 still matches the manifest, and - when OFFICE_ENGINE_TEST_URL
// is set - asks the real engine container for its capability rows and proves
// the pin and the honesty rule on it.
//
// Run: node --test scripts/office/integration.test.mjs
// Container required: OFFICE_REQUIRE_ENGINE=1 (fails instead of skipping) with
// OFFICE_ENGINE_TEST_URL, OFFICE_ENGINE_TEST_SERVICE_TOKEN,
// OFFICE_ENGINE_TEST_GRANT_KEY.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const read = (rel) => readFileSync(join(root, rel), "utf8");

const FORMATS = ["docx", "xlsx", "pptx", "pdf", "md", "html"];
const IN_SCOPE = ["docx", "pptx", "pdf", "md", "html"];

function constFrom(source, name) {
  const match = source.match(new RegExp(name + '\\s*=\\s*"([^"]+)"'));
  assert.ok(match, name + " not found");
  return match[1];
}

function numberFrom(source, name) {
  const match = source.match(new RegExp(name + "\\s*=\\s*(\\d+)"));
  assert.ok(match, name + " not found");
  return Number(match[1]);
}

const tsVersion = read("packages/office-contracts/src/version.ts");
const goContract = read("server/internal/office/contract.go");
const evidence = read("docs/office/g1-g2-evidence.md");
const manifest = JSON.parse(read("docs/office/g0/fixtures/manifest.json"));

const pins = {
  engine: constFrom(tsVersion, "ENGINE_VERSION_TRUSTED"),
  contract: constFrom(tsVersion, "ENGINE_CONTRACT_VERSION"),
  protocol: numberFrom(tsVersion, "ENGINE_PROTOCOL_VERSION"),
};

test("the Go and TypeScript contract identities are the same pin", () => {
  assert.equal(constFrom(goContract, "ContractVersion"), pins.contract);
  assert.equal(numberFrom(goContract, "ProtocolVersion"), pins.protocol);
  assert.equal(constFrom(goContract, "TrustedEngineVersion"), pins.engine);
});

test("the evidence doc records the same pin it was produced against", () => {
  assert.match(evidence, new RegExp(pins.engine.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(evidence, new RegExp(pins.contract.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("every in-scope format row names a fixture the manifest knows", () => {
  const rows = evidence
    .split("\n")
    .filter((line) => line.startsWith("|") && IN_SCOPE.some((f) => line.includes("| " + f + " |")));
  for (const format of IN_SCOPE) {
    const row = rows.find((line) => line.split("|").map((c) => c.trim())[1] === format);
    assert.ok(row, "evidence doc has no row for " + format);
    const fixtureIds = [...row.matchAll(/F-[A-Z0-9-]+/g)].map((m) => m[0]);
    assert.ok(fixtureIds.length > 0, format + " row names no fixture id");
    for (const id of fixtureIds) {
      const fixture = manifest.fixtures.find((f) => f.id === id);
      assert.ok(fixture, "unknown fixture id " + id + " in the " + format + " row");
      const bytes = readFileSync(join(root, "docs/office/g0/fixtures/files", fixture.path));
      const digest = createHash("sha256").update(bytes).digest("hex").toUpperCase();
      assert.equal(digest, fixture.sha256, "fixture " + id + " drifted from the manifest");
      assert.equal(bytes.length, fixture.bytes, "fixture " + id + " length drifted");
    }
  }
});

test("the evidence doc leaves no in-scope format claim without a test", () => {
  for (const format of IN_SCOPE) {
    assert.match(evidence, new RegExp("document_office_integration_test\\.go"), "integration test not named");
    assert.ok(evidence.includes(format), "format " + format + " missing");
  }
  // The engine build binds no docx/pptx handler: the doc must say so instead
  // of claiming a job row it cannot have.
  assert.match(evidence, /not_bound/);
});

test("the real engine container advertises the pin and the honesty rule", async (t) => {
  const url = process.env.OFFICE_ENGINE_TEST_URL?.trim();
  if (!url) {
    if (process.env.OFFICE_REQUIRE_ENGINE === "1") {
      assert.fail("OFFICE_ENGINE_TEST_URL is required (OFFICE_REQUIRE_ENGINE=1)");
    }
    t.diagnostic("not_run: OFFICE_ENGINE_TEST_URL is not set, the container rows were not exercised");
    return;
  }
  const token = process.env.OFFICE_ENGINE_TEST_SERVICE_TOKEN ?? "dev-only-office-engine-service-token-000001";
  for (const format of FORMATS) {
    const res = await fetch(url.replace(/\/$/, "") + "/v1/capability?format=" + format, {
      headers: { authorization: "Bearer " + token },
    });
    assert.equal(res.status, 200, "capability " + format);
    const body = await res.json();
    assert.equal(body.engine_version, pins.engine, "engine pin for " + format);
    const convert = body.capabilities.find((row) => row.operation === "convert");
    assert.equal(convert?.supported, false, "convert must stay unbound (Q7) for " + format);
    assert.match(convert?.reason ?? "", /q7/i);
    for (const row of body.capabilities) {
      if (row.supported) assert.equal(row.evidence_level, "pending");
      assert.ok(row.operation && row.runtime, "capability row without an operation/runtime");
    }
  }
});
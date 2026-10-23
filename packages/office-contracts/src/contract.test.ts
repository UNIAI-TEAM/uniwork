import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ENGINE_CONTRACT_VERSION,
  ENGINE_JOB_TRANSPORT,
  ENGINE_LIMITS,
  ENGINE_PROTOCOL_VERSION,
  ENGINE_ERROR_CODES,
  ENVELOPE_MAX_BYTES,
  EngineBoundaryError,
  EngineContractViolation,
  PAYLOAD_FIELDS,
  canonicalJson,
  decodeStrictBase64,
  encodeBase64,
  payloadFingerprint,
  validateEnvelope,
} from "./index.ts";

// Fixture-driven envelope parity: the same JSON files the Go parity test in
// server/internal/office consumes. If a fixture and the validator disagree,
// the contract is broken on at least one side.

const fixturesDir = join(import.meta.dirname, "..", "fixtures");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Record<string, unknown>;

const sha256Sync = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

describe("contract constants", () => {
  it("pins the G0 contract identity", () => {
    expect(ENGINE_CONTRACT_VERSION).toBe("uniwork-office-engine-contract/1");
    expect(ENGINE_PROTOCOL_VERSION).toBe(1);
    expect(ENGINE_JOB_TRANSPORT).toBe("framed/1");
  });

  it("every error code carries the full spec", () => {
    for (const [code, spec] of Object.entries(ENGINE_ERROR_CODES)) {
      expect(Number.isSafeInteger(spec.status), code).toBe(true);
      expect(spec.error_class.length, code).toBeGreaterThan(0);
      expect(spec.kind.length, code).toBeGreaterThan(0);
      expect(typeof spec.retryable, code).toBe("boolean");
    }
  });

  it("caps input and output at the 2 GiB document cap and the envelope prefix at 8 MiB", () => {
    // SIZE-OPS1: the input rides the framed body as raw bytes, so no V8
    // string bound applies any more; the JSON envelope prefix has its own cap.
    const TWO_GIB = 2 * 1024 * 1024 * 1024;
    expect(ENGINE_LIMITS.max_input_bytes).toBe(TWO_GIB);
    expect(ENGINE_LIMITS.max_output_bytes).toBe(TWO_GIB);
    expect(ENVELOPE_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

describe("validateEnvelope", () => {
  it("accepts the fixture open envelope and returns the declared input tuple", async () => {
    const fixture = loadFixture("envelope-open.v1.json");
    const out = await validateEnvelope(fixture.value);
    expect(out.operation).toBe("open");
    expect(out.format).toBe("docx");
    expect(out.inputs).toEqual({
      checksum: "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
      length: 5,
    });
  });

  it("rejects a caller-authority-named field (fixture)", async () => {
    const fixture = loadFixture("envelope-authority-violation.v1.json");
    const expected = fixture.expected as { field_path: string; rule: string };
    await expect(validateEnvelope(fixture.value)).rejects.toMatchObject({
      name: "EngineContractViolation",
      field_path: expected.field_path,
      rule: expected.rule,
    });
  });

  it("rejects an untrusted engine build as engine_incompatible, not a schema slip", async () => {
    const fixture = loadFixture("envelope-open.v1.json") as { value: Record<string, unknown> };
    const envelope = { ...fixture.value, client_engine_version: "genoffice@deadbeef+local.0" };
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineBoundaryError",
      code: "engine_incompatible",
      retryable: false,
    });
  });

  it("rejects an incomplete checksum tuple as a contract violation", async () => {
    const fixture = loadFixture("envelope-open.v1.json") as {
      value: { payload: Record<string, unknown> };
    };
    const envelope = structuredClone(fixture.value) as { payload: Record<string, unknown> };
    delete envelope.payload.input_length;
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineContractViolation",
      rule: "checksum_tuple_incomplete",
    });
  });

  it("rejects overwrite_source:true on convert before a job exists", async () => {
    const envelope = {
      request_id: "01J8Z2REQ00000000000000001",
      contract_version: ENGINE_CONTRACT_VERSION,
      protocol_version: ENGINE_PROTOCOL_VERSION,
      operation: "convert",
      format: "docx",
      deadline_ms: 30000,
      payload: {
        source_version_id: "01J8Z0V0000000000000000A",
        target_format: "pdf",
        overwrite_source: true,
      },
    };
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineContractViolation",
      field_path: "envelope.payload.overwrite_source",
      rule: "must_be_false",
    });
  });

  it("rejects an unknown payload key", async () => {
    const fixture = loadFixture("envelope-open.v1.json") as {
      value: { payload: Record<string, unknown> };
    };
    const envelope = structuredClone(fixture.value) as { payload: Record<string, unknown> };
    envelope.payload.surprise = 1;
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineContractViolation",
      rule: "unknown_field",
    });
  });

  it("requires deadline_ms except for cancel and capability", async () => {
    const fixture = loadFixture("envelope-open.v1.json") as { value: Record<string, unknown> };
    const envelope = structuredClone(fixture.value) as Record<string, unknown>;
    delete envelope.deadline_ms;
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineContractViolation",
      field_path: "envelope.deadline_ms",
    });

    const cancel = {
      request_id: "01J8Z2REQ00000000000000002",
      contract_version: ENGINE_CONTRACT_VERSION,
      protocol_version: ENGINE_PROTOCOL_VERSION,
      operation: "cancel",
      format: "docx",
      payload: { job_id: "JOB00000000000000000000001" },
    };
    const out = await validateEnvelope(cancel);
    expect(out.operation).toBe("cancel");
    expect(out.deadlineMs).toBeNull();
  });

  it("refuses a declared input_length over the transport ceiling as upload_bounds, without reading the bytes", async () => {
    // size-cap:005: an input above the engine ceiling is a typed 413, not a
    // schema slip - the bytes never even reach decode.
    const fixture = loadFixture("envelope-open.v1.json") as {
      value: { payload: Record<string, unknown> };
    };
    const envelope = structuredClone(fixture.value) as { payload: Record<string, unknown> };
    envelope.payload.input_length = ENGINE_LIMITS.max_input_bytes + 1;
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineBoundaryError",
      code: "upload_bounds",
      fields: { max_input_bytes: ENGINE_LIMITS.max_input_bytes },
    });
  });

  it("refuses a declared input_length over a host inputByteBound", async () => {
    // The engine hands its configured cap to the validator, so a declared
    // length over it is the typed 413 before a body byte is streamed.
    const fixture = loadFixture("envelope-open.v1.json") as {
      value: { payload: Record<string, unknown> };
    };
    const envelope = structuredClone(fixture.value) as { payload: Record<string, unknown> };
    envelope.payload.input_length = 128;
    await expect(validateEnvelope(envelope, { inputByteBound: 64 })).rejects.toMatchObject({
      name: "EngineBoundaryError",
      code: "upload_bounds",
      fields: { declared_length: 128, max_input_bytes: 64 },
    });
  });

  it("accepts a declared input_length at exactly the ceiling - the bound is strict", async () => {
    const fixture = loadFixture("envelope-open.v1.json") as {
      value: { payload: Record<string, unknown> };
    };
    const envelope = structuredClone(fixture.value) as { payload: Record<string, unknown> };
    envelope.payload.input_length = ENGINE_LIMITS.max_input_bytes;
    const out = await validateEnvelope(envelope);
    expect(out.inputs?.length).toBe(ENGINE_LIMITS.max_input_bytes);
  });

  it("refuses input_bytes in an envelope: the bytes ride the framed body only", async () => {
    const fixture = loadFixture("envelope-open.v1.json") as {
      value: { payload: Record<string, unknown> };
    };
    const envelope = structuredClone(fixture.value) as { payload: Record<string, unknown> };
    envelope.payload.input_bytes = "aGVsbG8=";
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineContractViolation",
      field_path: "envelope.payload.input_bytes",
      rule: "unknown_field",
    });
  });

  it("no operation's payload allowlist names input_bytes", () => {
    for (const [operation, fields] of Object.entries(PAYLOAD_FIELDS)) {
      expect(fields, operation).not.toContain("input_bytes");
    }
  });

  it("refuses a mismatched protocol_version with must_equal", async () => {
    const fixture = loadFixture("envelope-open.v1.json") as { value: Record<string, unknown> };
    const envelope = { ...structuredClone(fixture.value), protocol_version: ENGINE_PROTOCOL_VERSION + 1 };
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineContractViolation",
      field_path: "envelope.protocol_version",
      rule: "must_equal",
    });
  });

  it("rejects a negative declared input_length as a contract violation, not a boundary error", async () => {
    // R4-1 pin: min:0 stayed on requireSafeInt after the ceiling moved out of
    // the schema, so -1 is a wire violation, never an upload_bounds.
    const fixture = loadFixture("envelope-open.v1.json") as {
      value: { payload: Record<string, unknown> };
    };
    const envelope = structuredClone(fixture.value) as { payload: Record<string, unknown> };
    envelope.payload.input_length = -1;
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineContractViolation",
      field_path: "envelope.payload.input_length",
      rule: "below_min",
    });
  });

  it("rejects an unsafe declared input_length as a contract violation, not a boundary error", async () => {
    // R4-1 pin: Number.MAX_SAFE_INTEGER + 1 would otherwise read as an
    // over-ceiling declared length; the safe-integer check answers first.
    const fixture = loadFixture("envelope-open.v1.json") as {
      value: { payload: Record<string, unknown> };
    };
    const envelope = structuredClone(fixture.value) as { payload: Record<string, unknown> };
    envelope.payload.input_length = Number.MAX_SAFE_INTEGER + 1;
    await expect(validateEnvelope(envelope)).rejects.toMatchObject({
      name: "EngineContractViolation",
      field_path: "envelope.payload.input_length",
      rule: "safe_integer_required",
    });
  });

});

describe("canonicalJson + base64", () => {
  it("canonical ordering is deterministic regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(
      '{"a":{"c":[3,{"x":2,"y":1}],"d":2},"b":1}',
    );
  });

  it("strict base64 round-trips and rejects non-canonical encodings", () => {
    const bytes = new TextEncoder().encode("hello");
    const encoded = encodeBase64(bytes);
    expect(encoded).toBe("aGVsbG8=");
    expect(Array.from(decodeStrictBase64(encoded))).toEqual(Array.from(bytes));
    expect(() => decodeStrictBase64("aGVsbG8!")).toThrowError(/base64_alphabet/);
    expect(() => decodeStrictBase64("ABC")).toThrowError(/base64_length|base64_canonical/);
  });
});

describe("payloadFingerprint", () => {
  it("matches the parity fixture (Go mirrors this computation)", async () => {
    const fixture = loadFixture("fingerprint.v1.json") as {
      decisive: Record<string, unknown>;
      expected: { canonical: string; fingerprint: string };
    };
    expect(canonicalJson(fixture.decisive)).toBe(fixture.expected.canonical);
    const envelope = {
      request_id: "01J8Z2DIFFERENT00000000000",
      contract_version: fixture.decisive.contract_version,
      protocol_version: fixture.decisive.protocol_version,
      operation: fixture.decisive.operation,
      format: fixture.decisive.format,
      client_engine_version: fixture.decisive.engine_version,
      payload: {
        input_checksum: fixture.decisive.input_checksum,
        input_length: fixture.decisive.input_length,
        base_revision: fixture.decisive.base_revision,
        base_version_id: fixture.decisive.base_version_id,
      },
    };
    const fingerprint = await payloadFingerprint(envelope, { hash: sha256Sync });
    expect(fingerprint).toBe(fixture.expected.fingerprint);
  });

  it("changes when a decisive field changes but not when request_id changes", async () => {
    const base = {
      contract_version: ENGINE_CONTRACT_VERSION,
      protocol_version: ENGINE_PROTOCOL_VERSION,
      operation: "open",
      format: "docx",
      payload: { base_revision: 12, base_version_id: "01J8Z0V0000000000000000A" },
    };
    const a = await payloadFingerprint({ ...base, request_id: "A1" }, { hash: sha256Sync });
    const b = await payloadFingerprint({ ...base, request_id: "A2" }, { hash: sha256Sync });
    expect(a).toBe(b);
    const changed = await payloadFingerprint(
      { ...base, request_id: "A1", payload: { ...base.payload, base_revision: 13 } },
      { hash: sha256Sync },
    );
    expect(changed).not.toBe(a);
  });
});

describe("fixtures directory", () => {
  it("every fixture file declares its identity and expected block", () => {
    for (const name of readdirSync(fixturesDir).filter((f) => f.endsWith(".json"))) {
      const fixture = loadFixture(name);
      expect(typeof fixture.fixture, name).toBe("string");
      expect(fixture.expected, name).toBeTruthy();
    }
  });
});

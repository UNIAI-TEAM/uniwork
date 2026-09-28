import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  EngineContractViolation,
  capabilityEntrySchema,
  capabilityResultSchema,
  cancelResultSchema,
  errorEnvelopeSchema,
  jobGrantSchema,
  openFailureReportSchema,
  openOutcomeSchema,
  openResultSchema,
  scanForLeaks,
  serializeResultSchema,
  toProductCapabilities,
  toPublicJobResult,
} from "./index.ts";

const fixturesDir = join(import.meta.dirname, "..", "fixtures");
const loadFixture = (name: string) =>
  JSON.parse(readFileSync(join(fixturesDir, name), "utf8")) as Record<string, unknown>;

describe("capability honesty", () => {
  it("pending proof never becomes supported=true (fixture)", () => {
    const fixture = loadFixture("result-capability.v1.json") as {
      value: { capabilities: unknown[] };
      expected: { product_supported: Record<string, boolean> };
    };
    const entries = fixture.value.capabilities.map((e) => capabilityEntrySchema.parse(e));
    const product = toProductCapabilities(entries);
    for (const entry of product) {
      expect(entry.supported, entry.operation).toBe(fixture.expected.product_supported[entry.operation]);
      if (entry.supported) expect(entry.evidence_level).toBe("proven");
    }
  });

  it("a demoted row keeps its evidence and gains a reason", () => {
    const [product] = toProductCapabilities([
      { operation: "serialize", supported: true, runtime: "worker", evidence_level: "pending" },
    ]);
    expect(product).toBeDefined();
    expect(product!.supported).toBe(false);
    expect(product!.evidence_level).toBe("pending");
    expect(product!.reason).toContain("pending");
  });

  it("validates the capability result envelope", () => {
    const fixture = loadFixture("result-capability.v1.json");
    expect(() => capabilityResultSchema.parse(fixture.value)).not.toThrow();
  });
});

describe("grants", () => {
  it("accepts the fixture grant and lists the binding fields", () => {
    const fixture = loadFixture("grant.v1.json") as {
      value: unknown;
      expected: { binding_fields: string[] };
    };
    expect(() => jobGrantSchema.parse(fixture.value)).not.toThrow();
    for (const field of fixture.expected.binding_fields) {
      expect((fixture.value as Record<string, unknown>)[field]).toBeDefined();
    }
  });

  it("single_use must be the literal true", () => {
    const fixture = loadFixture("grant.v1.json") as { value: Record<string, unknown> };
    expect(() => jobGrantSchema.parse({ ...fixture.value, single_use: false })).toThrow();
  });
});

describe("result schemas", () => {
  it("open result carries a grant-scoped model ref, never a path", () => {
    const parsed = openResultSchema.parse({
      job_id: "JOB1",
      state: "completed",
      operation: "open",
      document_model_ref: "engine-session:JOB1",
      warnings: [{ code: "fonts_substituted", detail: "Liberation Serif → system serif" }],
    });
    expect(parsed.document_model_ref).toBe("engine-session:JOB1");
  });

  it("serialize result requires measured output tuple", () => {
    const parsed = serializeResultSchema.parse({
      job_id: "JOB2",
      state: "completed",
      operation: "serialize",
      output_object_key: "office/jobs/JOB2/docx.out",
      output_checksum: "a".repeat(64),
      output_length: 5,
      warnings: [],
    });
    expect(parsed.output_length).toBe(5);
  });

  it("cancel result states the truth about a committed job", () => {
    const parsed = cancelResultSchema.parse({
      job_id: "JOB3",
      previous_state: "running",
      state: "completed",
      version_id: "01J8Z0V0000000000000000B",
    });
    expect(parsed.state).toBe("completed");
  });

  it("accepts the fixture error envelope", () => {
    const fixture = loadFixture("error-envelope.v1.json");
    const parsed = errorEnvelopeSchema.parse(fixture.value);
    expect(parsed.error.code).toBe("engine_checksum_mismatch");
    expect(parsed.error.retryable).toBe(true);
    expect(parsed.error.fidelity_preserved).toBe(true);
  });
});

describe("P3 open-failure report", () => {
  it("accepts the fixture report - a named class, bound to the document id", () => {
    const fixture = loadFixture("open-failure.v1.json");
    const parsed = openOutcomeSchema.parse(fixture.value);
    expect(parsed.outcome).toBe("failed");
    if (parsed.outcome === "failed") {
      expect(parsed.failure_class).toBe("wrong_password");
      expect(parsed.document_id).toBe("01J8Z0D000000000000000DOC");
    }
  });

  it("a failure report is a distinct outcome - never a blank substitute", () => {
    const report = openFailureReportSchema.parse({
      document_id: "doc-1",
      format: "docx",
      failure_class: "corrupted",
    });
    expect(report.failure_class).toBe("corrupted");
    expect(openOutcomeSchema.parse({ ...report, outcome: "failed" }).outcome).toBe("failed");
  });
});

describe("leak scanning + public projection", () => {
  it("detects paths, storage keys and credentials", () => {
    expect(scanForLeaks({ note: "see /home/worker/file.docx" })).toContain("posix_absolute_path");
    expect(scanForLeaks({ note: "C:\\work\\file.docx" })).toContain("windows_absolute_path");
    expect(scanForLeaks({ object_key: "office/x" })).toContain("storage_key_field");
    expect(scanForLeaks({ access_token: "t" })).toContain("credential_field");
    expect(scanForLeaks({ document_model_ref: "engine-session:J1", warnings: [] })).toEqual([]);
  });

  it("detects the alternate spellings of the same leaks", () => {
    expect(scanForLeaks({ note: "under /root/.ssh/id" })).toContain("posix_absolute_path");
    expect(scanForLeaks({ note: "see C:/work/file.docx" })).toContain("windows_forward_path");
    expect(scanForLeaks({ note: "on //fs01/shared/x" })).toContain("unc_forward_path");
    expect(scanForLeaks({ link: "https://docs.example/x" })).not.toContain("unc_forward_path");
    expect(scanForLeaks({ link: "https://docs.example/x" })).not.toContain("windows_forward_path");
  });

  it("detects forward-slash paths after punctuation, not just whitespace", () => {
    for (const note of ["copy,C:/work/file.docx", "from[C:/work/file.docx]", "see>C:/work/file.docx"]) {
      expect(scanForLeaks({ note })).toContain("windows_forward_path");
    }
    for (const note of ["copy,//fs01/shared/x", "from[//fs01/shared/x]", "see>//fs01/shared/x"]) {
      expect(scanForLeaks({ note })).toContain("unc_forward_path");
    }
  });

  it("strips authority/storage fields from a public result", () => {
    const internal = {
      job_id: "J1",
      state: "completed",
      operation: "serialize",
      output_object_key: "office/jobs/J1/docx.out",
      output_checksum: "a".repeat(64),
      output_length: 10,
      actor_id: "A1",
      organization_id: "ORG1",
      workspace_id: "WS1",
      warnings: [],
    };
    const pub = toPublicJobResult(internal);
    expect(pub.output_object_key).toBeUndefined();
    expect(pub.actor_id).toBeUndefined();
    expect(pub.output_checksum).toBe("a".repeat(64));
  });

  it("refuses to emit a projection that would still leak", () => {
    const internal = {
      job_id: "J1",
      state: "completed",
      operation: "open",
      document_model_ref: "engine-session:J1",
      message: "wrote /tmp/engine/output.docx",
    };
    expect(() => toPublicJobResult(internal)).toThrow(EngineContractViolation);
  });
});

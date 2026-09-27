import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import {
  DocumentAssetSchema,
  DocumentDownloadSchema,
  DocumentEnvelopeSchema,
  DocumentErrorEnvelopeSchema,
  DocumentUploadSchema,
  DocumentVersionEnvelopeSchema,
  DocumentVersionListEnvelopeSchema,
  DocumentVersionResultEnvelopeSchema,
} from "../types/document";

// The TS half of the documents-api contract: every sample in
// docs/parity/documents-api must parse through the same lenient schemas the
// endpoints use, and every error_class must carry a parseable envelope
// sample. The Go test in server/internal/handler/dto/sdo decodes the same
// files strictly — together they pin the wire until the routes exist.

const CONTRACT_DIR = resolve(process.cwd(), "../../docs/parity/documents-api");

const IndexSchema = z.object({
  contract_version: z.string(),
  endpoints: z.array(
    z.object({
      name: z.string(),
      method: z.string(),
      path: z.string(),
      request_kind: z.enum(["json", "form", "query", "none"]),
      request: z.string().optional(),
      response_kind: z.enum(["json", "stream"]),
      response: z.string().optional(),
      sdi: z.string().optional(),
      sdo: z.string().optional(),
    }),
  ),
  error_classes: z.array(z.string()),
  error_samples: z.array(z.object({ error_class: z.string(), file: z.string() })),
});

function readSample(name: string): unknown {
  return JSON.parse(readFileSync(resolve(CONTRACT_DIR, name), "utf8"));
}

const SDO_SCHEMAS: Record<string, z.ZodType> = {
  DocumentSDO: DocumentEnvelopeSchema,
  DocumentUploadSDO: DocumentUploadSchema,
  DocumentVersionSDO: DocumentVersionEnvelopeSchema,
  DocumentVersionListSDO: DocumentVersionListEnvelopeSchema,
  DocumentVersionResultSDO: DocumentVersionResultEnvelopeSchema,
  DocumentAssetSDO: DocumentAssetSchema,
  DocumentDownloadSDO: DocumentDownloadSchema,
};

// Request bodies are strict in the contract test on purpose: the sample
// defines the wire, so a drifted key fails here exactly like Go's
// DisallowUnknownFields.
const SDI_JSON_SCHEMAS: Record<string, z.ZodType> = {
  CreateDocumentSDI: z
    .object({
      title: z.string(),
      kind: z.string().optional(),
      parent_id: z.string().optional(),
      icon: z.string().optional(),
      content: z.unknown().optional(),
      visibility: z.string().optional(),
    })
    .strict(),
  PatchDocumentSDI: z
    .object({
      revision: z.string(),
      title: z.string().optional(),
      icon: z.string().optional(),
      content: z.unknown().optional(),
      visibility: z.string().optional(),
    })
    .strict(),
  CommitDocumentVersionSDI: z
    .object({ upload_id: z.string(), base_revision: z.string() })
    .strict(),
  CreateDocumentVersionSDI: z.object({ label: z.string().optional() }).strict(),
};

// form/query samples only name declared wire keys (the Go test reads the
// formData/query tags reflectively; this list mirrors them).
const SDI_WIRE_KEYS: Record<string, string[]> = {
  CreateDocumentFileSDI: ["file", "parent_id", "title"],
  UploadDocumentFileSDI: ["file"],
  UploadDocumentAssetSDI: ["file"],
  ListDocumentVersionsSDI: ["cursor", "limit"],
  DownloadDocumentSDI: ["version", "meta"],
};

const index = IndexSchema.parse(readSample("index.json"));

describe("documents-api contract", () => {
  it("has a versioned contract id", () => {
    expect(index.contract_version).toMatch(/^documents-api\/\d+$/);
  });

  it("declares every endpoint kind consistently", () => {
    for (const ep of index.endpoints) {
      if (ep.request_kind === "none") expect(ep.request).toBeUndefined();
      else expect(ep.request).toBeTruthy();
      if (ep.response_kind === "json") {
        expect(ep.response).toBeTruthy();
        expect(SDO_SCHEMAS[ep.sdo ?? ""]).toBeTruthy();
      }
      if (ep.request_kind === "json") {
        expect(SDI_JSON_SCHEMAS[ep.sdi ?? ""]).toBeTruthy();
      }
      if (ep.request_kind === "form" || ep.request_kind === "query") {
        expect(SDI_WIRE_KEYS[ep.sdi ?? ""]).toBeTruthy();
      }
    }
  });

  for (const ep of index.endpoints) {
    it(`response sample parses: ${ep.name}`, () => {
      if (ep.response_kind !== "json" || !ep.response || !ep.sdo) return;
      const schema = SDO_SCHEMAS[ep.sdo];
      if (!schema) throw new Error(`unknown sdo ${ep.sdo}`);
      const parsed = schema.safeParse(readSample(ep.response));
      expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
    });

    it(`request sample parses: ${ep.name}`, () => {
      if (ep.request_kind === "none" || !ep.request) return;
      const sample = readSample(ep.request);
      if (ep.request_kind === "json") {
        const schema = SDI_JSON_SCHEMAS[ep.sdi ?? ""];
        if (!schema) throw new Error(`unknown sdi ${ep.sdi}`);
        const parsed = schema.safeParse(sample);
        expect(parsed.success, JSON.stringify(parsed.success ? null : parsed.error.issues)).toBe(true);
      } else {
        const allowed = new Set(SDI_WIRE_KEYS[ep.sdi ?? ""] ?? []);
        for (const [key, value] of Object.entries(sample as Record<string, unknown>)) {
          expect(allowed.has(key), `key ${key} not declared on ${ep.sdi}`).toBe(true);
          // Form and query values are strings on the wire; a number or bool
          // in the sample would silently drift from the request's real type.
          expect(typeof value, `value ${key} of ${ep.sdi} must be a string`).toBe("string");
        }
      }
    });
  }

  it("every declared error_class has a parseable envelope sample", () => {
    const declared = new Set(index.error_classes);
    const seen = new Set<string>();
    for (const { error_class, file } of index.error_samples) {
      expect(declared.has(error_class)).toBe(true);
      const parsed = DocumentErrorEnvelopeSchema.safeParse(readSample(file));
      expect(parsed.success).toBe(true);
      if (parsed.success) {
        expect(parsed.data.error.error_class).toBe(error_class);
        expect(parsed.data.error.code.length).toBeGreaterThan(0);
        expect(parsed.data.error.message.length).toBeGreaterThan(0);
      }
      seen.add(error_class);
    }
    expect([...declared].sort()).toEqual([...seen].sort());
  });

  it("revisions on the wire are decimal strings", () => {
    // The samples pin revision as a string; a numeric revision in a sample
    // would slip past a loose schema, so assert on raw JSON.
    const patch = DocumentEnvelopeSchema.parse(readSample("patch-document.response.json"));
    expect(typeof patch.document.revision).toBe("string");
    const commit = DocumentVersionResultEnvelopeSchema.parse(
      readSample("commit-document-version.response.json"),
    );
    expect(typeof commit.document.revision).toBe("string");
  });
});

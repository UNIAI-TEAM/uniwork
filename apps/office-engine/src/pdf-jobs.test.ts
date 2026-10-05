// G2-05 pdf lane end-to-end through the real service: HTTP submit → worker
// process (type-stripped entry) → handler → PUT to the grant's target. The
// same envelope path Documents uses; output is verified with the package's
// independent text extraction.
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { readPdfText } from "@uniwork/office-engine/pdf";
import { findHandler } from "./worker/handlers.ts";
import type { RunMessage } from "./worker/protocol.ts";
import {
  call,
  errorCode,
  errorReason,
  makeJob,
  startHarness,
  submit,
  waitTerminal,
  type Harness,
  type JobSpec,
} from "../test/harness.ts";

const FIXTURES = fileURLToPath(
  new URL("../../../docs/office/g0/fixtures/files/pdf/", import.meta.url),
);
const pdfFixture = async (name: string) => new Uint8Array(await readFile(FIXTURES + name));

let h: Harness;
beforeAll(async () => {
  h = await startHarness();
});
afterAll(async () => {
  await h.close();
});

function pdfJob(target: Harness["target"], spec: Omit<JobSpec, "text"> & { text?: string }) {
  return makeJob(target, { format: "pdf", ...spec });
}

describe("pdf jobs through the service", () => {
  it("edit:pdf applies a text edit and delivers verified bytes to the target", async () => {
    const input = await pdfFixture("pdf-text-editable.pdf");
    const job = pdfJob(h.target, {
      bytes: input,
      operation: "edit",
      payload: {
        edits: [
          {
            op: "putTextEdit",
            attributes: {
              pageIndex: 0,
              rect: [0, 0, 612, 792],
              oldText: "Bao cao tong hop nam 2026",
              newText: "Bao cao tong hop nam 2030",
              fontSize: 14,
            },
          },
        ],
      },
    });
    const reply = await submit(h, job);
    expect(reply.status).toBe(202);
    const done = await waitTerminal(h, job);
    expect(done.body.state, JSON.stringify(done.body)).toBe("completed");
    // Original preserved, output carries the new text.
    const uploaded = h.target.uploads.at(-1)!.body;
    const text = await readPdfText(new Uint8Array(uploaded));
    expect(text.pages[0]!.text).toContain("nam 2030");
    expect(text.pages[0]!.text).not.toContain("nam 2026");
  });

  it("serialize:pdf passes the committed bytes through unchanged", async () => {
    const input = await pdfFixture("pdf-text-editable.pdf");
    const job = pdfJob(h.target, {
      bytes: input,
      operation: "serialize",
      payload: { document_model_ref: "ver-3" },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state, JSON.stringify(done.body)).toBe("completed");
    expect(new Uint8Array(h.target.uploads.at(-1)!.body)).toEqual(input);
  });

  it("open:pdf returns a probe document with the OCR refusal", async () => {
    const input = await pdfFixture("pdf-text-editable.pdf");
    const job = pdfJob(h.target, {
      bytes: input,
      operation: "open",
      payload: { base_revision: 3, base_version_id: "ver-3" },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state, JSON.stringify(done.body)).toBe("completed");
    const probe = JSON.parse(h.target.uploads.at(-1)!.body.toString("utf8")) as {
      document_model: { pageCount: number; hasTextLayer: boolean; features: { ocr: boolean } };
    };
    expect(probe.document_model.pageCount).toBe(2);
    expect(probe.document_model.hasTextLayer).toBe(true);
    expect(probe.document_model.features.ocr).toBe(false);
  });

  it("fails encrypted input with a typed engine error, original untouched", async () => {
    const input = await pdfFixture("pdf-cert-encrypted.pdf");
    const job = pdfJob(h.target, {
      bytes: input,
      operation: "edit",
      payload: { edits: [{ op: "setMetadata", attributes: { title: "x" } }] },
    });
    const uploadsBefore = h.target.uploads.length;
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("failed");
    expect(errorCode(done)).toBe("engine_result_invalid");
    expect(errorReason(done)).toBe("encrypted_pdf");
    expect(h.target.uploads.length).toBe(uploadsBefore);
  });

  it("fails a corrupt pdf with a typed engine error", async () => {
    const input = await pdfFixture("pdf-corrupt.pdf");
    const job = pdfJob(h.target, {
      bytes: input,
      operation: "edit",
      payload: { edits: [{ op: "setMetadata", attributes: { title: "x" } }] },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("failed");
    expect(errorCode(done)).toBe("engine_result_invalid");
    expect(errorReason(done)).toBe("corrupt_pdf");
  });

  it("fails an unbound pdf op vocabulary as unsupported_operation", async () => {
    // addMarkup is bound since the G3 PDF lane; ocrPage is the vocabulary the
    // engine build deliberately leaves unbound (no optical engine in service).
    const input = await pdfFixture("pdf-text-editable.pdf");
    const job = pdfJob(h.target, {
      bytes: input,
      operation: "edit",
      payload: { edits: [{ op: "ocrPage", attributes: {} }] },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("failed");
    expect(errorCode(done)).toBe("unsupported_operation");
  });

  it("fails a bound pdf op with a malformed payload as engine_result_invalid", async () => {
    const input = await pdfFixture("pdf-text-editable.pdf");
    const job = pdfJob(h.target, {
      bytes: input,
      operation: "edit",
      payload: { edits: [{ op: "addMarkup", attributes: {} }] },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state).toBe("failed");
    expect(errorCode(done)).toBe("engine_result_invalid");
  });

  it("reports a skipped (stale) text edit as a warning, not a failure", async () => {
    const input = await pdfFixture("pdf-text-editable.pdf");
    const job = pdfJob(h.target, {
      bytes: input,
      operation: "edit",
      payload: {
        edits: [
          {
            op: "putTextEdit",
            attributes: {
              pageIndex: 0,
              rect: [0, 0, 612, 792],
              oldText: "no such string",
              newText: "x",
              fontSize: 12,
            },
          },
        ],
      },
    });
    await submit(h, job);
    const done = await waitTerminal(h, job);
    expect(done.body.state, JSON.stringify(done.body)).toBe("completed");
    const warnings = (done.body.warnings ?? []) as { code: string }[];
    expect(warnings.some((w) => w.code === "edit_skipped")).toBe(true);
  });
});

describe("pdf handlers (file seam)", () => {
  it("edit:pdf fails typed when ops.json is missing", async () => {
    const dir = await mkdtemp(join(tmpdir(), "uw-pdf-handler-"));
    const input = await pdfFixture("pdf-text-editable.pdf");
    await writeFile(join(dir, "input.bin"), input);
    const handler = findHandler("edit", "pdf")!;
    const message: RunMessage = {
      type: "run",
      operation: "edit",
      format: "pdf",
      inputPath: join(dir, "input.bin"),
      outputPath: join(dir, "output.bin"),
      payloadPath: null,
      tempDir: dir,
      sampleMs: 50,
      heapMb: 256,
      faults: false,
    };
    const outcome = await handler(message);
    expect(outcome).toMatchObject({ ok: false, code: "engine_result_invalid", reason: "ops_payload_missing" });
  });
});

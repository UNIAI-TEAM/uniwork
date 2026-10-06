import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import { describe, expect, it } from "vitest";
import { fakeMarkdownUpstream } from "./assets/test-fakes";
import { DocxAdapter } from "./docx/adapter";
import { createMarkdownEngine } from "./markdown/engine";
import { PptxAdapter } from "./pptx/adapter";
import { XlsxAdapter } from "./xlsx/adapter.ts";

// The server contract bounds (ENGINE_LIMITS) stay the default; the desktop
// host injects Number.POSITIVE_INFINITY because a local file is not capped.
// A zero-filled buffer is not an OOXML package, so an adapter that got past
// the size gate answers not_office_file instead of too_large.
const OVER_INPUT = new Uint8Array(ENGINE_LIMITS.max_input_bytes + 1);

const adapters = {
  docx: (maxInputBytes?: number) => new DocxAdapter({ engine: {} as never, ...(maxInputBytes === undefined ? {} : { maxInputBytes }) }),
  pptx: (maxInputBytes?: number) => new PptxAdapter({ engine: {} as never, ops: {} as never, ...(maxInputBytes === undefined ? {} : { maxInputBytes }) }),
  xlsx: (maxInputBytes?: number) => new XlsxAdapter({ engine: {} as never, ...(maxInputBytes === undefined ? {} : { maxInputBytes }) }),
} as const;

describe.each(["docx", "pptx", "xlsx"] as const)("%s adapter input bound", (format) => {
  it("keeps refusing an over-bound input as too_large by default (web)", async () => {
    const outcome = await adapters[format]().open({ bytes: OVER_INPUT, format, document_id: "D1" });
    expect(outcome).toMatchObject({ outcome: "failed", failure_class: "too_large" });
  });

  it("passes the size gate when the host injects an unbounded input", async () => {
    const outcome = await adapters[format](Number.POSITIVE_INFINITY).open({ bytes: OVER_INPUT, format, document_id: "D1" });
    expect(outcome).toMatchObject({ outcome: "failed", failure_class: "not_office_file" });
  });
});

describe("markdown engine input bound", () => {
  it("opens an over-bound source when the host injects an unbounded input", async () => {
    const md = createMarkdownEngine({ upstream: fakeMarkdownUpstream(), maxInputBytes: Number.POSITIVE_INFINITY });
    await expect(md.open({ bytes: OVER_INPUT, format: "md", document_id: "D1" })).resolves.toMatchObject({ outcome: "opened" });
  });
});

import { ENGINE_LIMITS } from "@uniwork/office-contracts";
import { describe, expect, it } from "vitest";
import { XlsxAdapter } from "./xlsx/adapter.ts";

// The server contract bounds (ENGINE_LIMITS) stay the default; a host may
// inject Number.POSITIVE_INFINITY. A zero-filled buffer is not an OOXML
// package, so an adapter that got past the size gate answers not_office_file
// instead of too_large. Since SIZE-OPS1 the bound is 2 GiB, so the over-bound
// input is a stand-in that only reports its length (zero bytes read as
// undefined) instead of a real 2 GiB allocation.
const OVER_INPUT = { length: ENGINE_LIMITS.max_input_bytes + 1 } as unknown as Uint8Array;

const adapter = (maxInputBytes?: number) =>
  new XlsxAdapter({ engine: {} as never, ...(maxInputBytes === undefined ? {} : { maxInputBytes }) });

describe("xlsx adapter input bound", () => {
  it("keeps refusing an over-bound input as too_large by default", async () => {
    const outcome = await adapter().open({ bytes: OVER_INPUT, format: "xlsx", document_id: "D1" });
    expect(outcome).toMatchObject({ outcome: "failed", failure_class: "too_large" });
  });

  it("passes the size gate when the host injects an unbounded input", async () => {
    const outcome = await adapter(Number.POSITIVE_INFINITY).open({ bytes: OVER_INPUT, format: "xlsx", document_id: "D1" });
    expect(outcome).toMatchObject({ outcome: "failed", failure_class: "not_office_file" });
  });
});

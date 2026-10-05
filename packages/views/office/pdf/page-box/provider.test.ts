import { describe, expect, it, vi } from "vitest";
import { createPdfPageBoxOperationProvider, MAX_NUP_PAGES_PER_SHEET, PdfPageBoxProviderError } from "./index";
import type {
  PdfPageBoxEngineOperation,
  PdfPageBoxLayout,
  PdfPageBoxOperationSubmitter,
  PdfPageBoxPaper,
  PdfPageBoxRect,
  PdfPageBoxSetNUpInput,
  PdfPageBoxSetPageBoxInput,
} from "./index";

function submitter(): PdfPageBoxOperationSubmitter & { submit: ReturnType<typeof vi.fn> } {
  return { submit: vi.fn(async () => undefined) };
}

describe("createPdfPageBoxOperationProvider — setPageBox", () => {
  it("submits exactly one typed envelope and dedupes the page list", async () => {
    const submit = submitter();
    const provider = createPdfPageBoxOperationProvider(submit);

    await provider.setPageBox({ pages: [2, 1, 2], box: "crop", rect: [0, 0, 595.28, 841.89] });

    expect(submit.submit).toHaveBeenCalledTimes(1);
    expect(submit.submit).toHaveBeenCalledWith([
      { op: "setPageBox", pages: [2, 1], box: "crop", rect: [0, 0, 595.28, 841.89] },
    ]);
  });

  it("accepts the media box", async () => {
    const submit = submitter();
    const input: PdfPageBoxSetPageBoxInput = { pages: [1], box: "media", rect: [10, 10, 200, 300] };
    await createPdfPageBoxOperationProvider(submit).setPageBox(input);
    expect(submit.submit).toHaveBeenCalledWith([
      { op: "setPageBox", pages: [1], box: "media", rect: [10, 10, 200, 300] },
    ]);
  });

  it("refuses an empty selection, a bad page number and an inverted rect before submitting", async () => {
    const submit = submitter();
    const provider = createPdfPageBoxOperationProvider(submit);

    await expect(provider.setPageBox({ pages: [], box: "crop", rect: [0, 0, 10, 10] })).rejects.toBeInstanceOf(PdfPageBoxProviderError);
    await expect(provider.setPageBox({ pages: [0], box: "crop", rect: [0, 0, 10, 10] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(provider.setPageBox({ pages: [1.5], box: "crop", rect: [0, 0, 10, 10] })).rejects.toMatchObject({ code: "invalid_input" });
    // Zero height, inverted bounds and a short tuple all clip the page away.
    await expect(provider.setPageBox({ pages: [1], box: "crop", rect: [0, 10, 10, 10] })).rejects.toThrow("positive width and height");
    await expect(provider.setPageBox({ pages: [1], box: "crop", rect: [10, 0, 0, 10] })).rejects.toThrow("positive width and height");
    await expect(provider.setPageBox({ pages: [1], box: "crop", rect: [0, 0, 10] as never })).rejects.toThrow("four finite points");
    await expect(provider.setPageBox({ pages: [1], box: "crop", rect: [0, 0, Number.NaN, 10] })).rejects.toThrow("four finite points");
    await expect(provider.setPageBox({ pages: [1], box: "bleed" as never, rect: [0, 0, 10, 10] })).rejects.toThrow("unsupported page box");
    expect(submit.submit).not.toHaveBeenCalled();
  });
});

describe("createPdfPageBoxOperationProvider — setNUp", () => {
  it("submits a grid without a paper size when none was chosen", async () => {
    const submit = submitter();
    await createPdfPageBoxOperationProvider(submit).setNUp({ pages: [1, 2, 3], layout: { rows: 1, cols: 2 } });
    expect(submit.submit).toHaveBeenCalledWith([{ op: "setNUp", pages: [1, 2, 3], layout: { rows: 1, cols: 2 } }]);
  });

  it("carries the chosen paper size", async () => {
    const submit = submitter();
    await createPdfPageBoxOperationProvider(submit).setNUp({ pages: [4], layout: { rows: 2, cols: 2 }, paper: "a4" });
    expect(submit.submit).toHaveBeenCalledWith([
      { op: "setNUp", pages: [4], layout: { rows: 2, cols: 2 }, paper: "a4" },
    ]);
  });

  it("refuses a layout outside the engine's 2–16 pages per sheet and an unknown paper size", async () => {
    const submit = submitter();
    const provider = createPdfPageBoxOperationProvider(submit);

    await expect(provider.setNUp({ pages: [1], layout: { rows: 1, cols: 1 } })).rejects.toMatchObject({ code: "unsupported_layout" });
    await expect(provider.setNUp({ pages: [1], layout: { rows: 0, cols: 2 } })).rejects.toMatchObject({ code: "unsupported_layout" });
    await expect(provider.setNUp({ pages: [1], layout: { rows: 5, cols: 5 } })).rejects.toThrow(`between 2 and ${MAX_NUP_PAGES_PER_SHEET}`);
    await expect(provider.setNUp({ pages: [], layout: { rows: 1, cols: 2 } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(provider.setNUp({ pages: [1], layout: { rows: 1, cols: 2 }, paper: "a3" as never })).rejects.toThrow("unsupported paper size");
    expect(submit.submit).not.toHaveBeenCalled();
  });

  it("keeps every submitted envelope serialisable", async () => {
    const layout: PdfPageBoxLayout = { rows: 2, cols: 1 };
    const paper: PdfPageBoxPaper = "letter";
    const rect: PdfPageBoxRect = [0, 0, 1, 1];
    const nUp: PdfPageBoxSetNUpInput = { pages: [1, 2], layout, paper };
    const seen: PdfPageBoxEngineOperation[] = [];
    const provider = createPdfPageBoxOperationProvider({ submit: (operations) => { seen.push(...operations); } });
    await provider.setPageBox({ pages: [1], box: "media", rect });
    await provider.setNUp(nUp);
    expect(seen).toEqual([
      { op: "setPageBox", pages: [1], box: "media", rect: [0, 0, 1, 1] },
      { op: "setNUp", pages: [1, 2], layout: { rows: 2, cols: 1 }, paper: "letter" },
    ]);
    expect(JSON.parse(JSON.stringify(seen))).toEqual(seen);
  });
});

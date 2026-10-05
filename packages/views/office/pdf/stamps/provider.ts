import type {
  PdfStampEngineOperation,
  PdfStampInput,
  PdfStampOperationProvider,
  PdfStampOperationSubmitter,
  PdfStampPlacement,
  PdfStampProviderOptions,
  PdfStampRect,
} from "./types";

export class PdfStampProviderError extends Error {
  readonly code: "invalid_input" | "unsupported_operation";

  constructor(code: PdfStampProviderError["code"], message: string) {
    super(message);
    this.name = "PdfStampProviderError";
    this.code = code;
  }
}

function pageIndex(page: number, order: readonly number[] | undefined): number {
  if (!Number.isSafeInteger(page) || page < 0) throw new PdfStampProviderError("invalid_input", "pageIndex must be a non-negative integer");
  const mapped = order ? order[page] : page;
  if (mapped === undefined) throw new PdfStampProviderError("invalid_input", "pageIndex is outside the current page order");
  return mapped;
}

function rect(value: readonly number[]): PdfStampRect {
  if (value.length !== 4 || !value.every((entry) => Number.isFinite(entry))) {
    throw new PdfStampProviderError("invalid_input", "rect must contain four finite coordinates");
  }
  const result = [value[0]!, value[1]!, value[2]!, value[3]!] as PdfStampRect;
  if (result[2] <= result[0] || result[3] <= result[1]) throw new PdfStampProviderError("invalid_input", "rect must have positive dimensions");
  return result;
}

function quarterTurns(value: number | undefined): 0 | 90 | 180 | 270 | undefined {
  if (value === undefined) return undefined;
  if (value !== 0 && value !== 90 && value !== 180 && value !== 270) {
    throw new PdfStampProviderError("invalid_input", "quarterTurns must be 0, 90, 180 or 270");
  }
  return value;
}

interface ResolvedPlacement {
  pageIndex: number;
  rect: PdfStampRect;
  quarterTurns?: 0 | 90 | 180 | 270;
}

function placement(input: PdfStampPlacement, options: PdfStampProviderOptions): ResolvedPlacement {
  const turns = quarterTurns(input.quarterTurns);
  return {
    pageIndex: pageIndex(input.pageIndex, options.pageOrder),
    rect: rect(input.rect),
    ...(turns === undefined ? {} : { quarterTurns: turns }),
  };
}

/** The engine envelope for one validated input. Kept exported so the seam's
 *  shape is testable without a submitter and so the host adapter has exactly
 *  one place that decides how a stamp becomes an engine op. */
export function buildStampOperation(input: PdfStampInput, options: PdfStampProviderOptions = {}): PdfStampEngineOperation {
  if (input.kind === "signature" && (input.signatureId ?? "") === "") {
    throw new PdfStampProviderError("invalid_input", "a signature stamp needs a signature id");
  }
  if (typeof input.contentType !== "string" || input.contentType.trim() === "") {
    throw new PdfStampProviderError("invalid_input", "contentType is required");
  }
  if (typeof input.image !== "string" || input.image === "") {
    throw new PdfStampProviderError("invalid_input", "image bytes are required");
  }
  const target = placement(input.placement, options);
  return {
    op: "addStamp",
    attributes: {
      stamp: {
        kind: input.kind,
        pageIndex: target.pageIndex,
        rect: target.rect,
        contentType: input.contentType,
        image: input.image,
        ...(input.signatureId === undefined ? {} : { signatureId: input.signatureId }),
        ...(target.quarterTurns === undefined ? {} : { quarterTurns: target.quarterTurns }),
      },
    },
  };
}

/**
 * Browser-safe stamp provider (UNI-925 B6). It validates the placement and
 * hands the host a typed `addStamp` envelope; the engine operation itself is
 * not implemented yet, so a host that cannot place stamps leaves the submitter
 * to reject and the palette surfaces that as an alert. No office-engine or
 * Node import crosses this module.
 */
export function createPdfStampOperationProvider(
  options: PdfStampProviderOptions,
  submitter: PdfStampOperationSubmitter,
): PdfStampOperationProvider {
  return {
    async placeStamp(input: PdfStampInput) {
      await submitter.submit([buildStampOperation(input, options)]);
    },
  };
}

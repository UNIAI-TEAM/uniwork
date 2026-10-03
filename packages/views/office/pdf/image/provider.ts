import type { PdfObjectMetadata } from "../ops-bridge";
import type {
  PdfImageDeleteInput,
  PdfImageEngineOperation,
  PdfImageOperationProvider,
  PdfImageOperationSubmitter,
  PdfImageProviderOptions,
  PdfImageReplaceInput,
  PdfImageTransformInput,
} from "./types";
import type { PdfImageInsertInput } from "./types";

export class PdfImageProviderError extends Error {
  readonly code: "invalid_input" | "object_unavailable";

  constructor(code: PdfImageProviderError["code"], message: string) {
    super(message);
    this.name = "PdfImageProviderError";
    this.code = code;
  }
}

function pageIndex(page: number, order: readonly number[] | undefined): number {
  if (!Number.isSafeInteger(page) || page < 0) throw new PdfImageProviderError("invalid_input", "pageIndex must be a non-negative integer");
  const mapped = order ? order[page] : page;
  if (mapped === undefined) throw new PdfImageProviderError("invalid_input", "pageIndex is outside the current page order");
  return mapped;
}

function rect(rect: readonly number[], name: string): [number, number, number, number] {
  if (rect.length !== 4 || !rect.every((value) => Number.isFinite(value))) throw new PdfImageProviderError("invalid_input", `${name} must contain four finite coordinates`);
  const result = [rect[0]!, rect[1]!, rect[2]!, rect[3]!] as [number, number, number, number];
  if (result[2] <= result[0] || result[3] <= result[1]) throw new PdfImageProviderError("invalid_input", `${name} must have positive dimensions`);
  return result;
}

function imageBase64(image: Uint8Array): string {
  if (!(image instanceof Uint8Array) || image.length === 0) throw new PdfImageProviderError("invalid_input", "image bytes are required");
  if (typeof globalThis.btoa !== "function") throw new PdfImageProviderError("invalid_input", "base64 encoder is unavailable");
  let binary = "";
  for (let offset = 0; offset < image.length; offset += 0x8000) binary += String.fromCharCode(...image.subarray(offset, offset + 0x8000));
  return globalThis.btoa(binary);
}

async function objectMetadata(options: PdfImageProviderOptions, target: { page: number; objectId: string }): Promise<PdfObjectMetadata> {
  if (!options.resolveObject) throw new PdfImageProviderError("object_unavailable", "selected image object could not be resolved");
  const value = await options.resolveObject(target);
  if (!value || value.page !== target.page || value.objectId !== target.objectId) throw new PdfImageProviderError("object_unavailable", "selected image object could not be resolved");
  return value;
}

function submitInsert(input: PdfImageInsertInput, options: PdfImageProviderOptions): PdfImageEngineOperation {
  return {
    op: "addImageEdit",
    attributes: {
      kind: "insertImage",
      pageIndex: pageIndex(input.pageIndex, options.pageOrder),
      rect: rect(input.rect, "rect"),
      image: imageBase64(input.image),
      layer: input.layer,
      ...(input.rotate === undefined ? {} : { rotate: input.rotate }),
    },
  };
}

function submitTransform(input: PdfImageTransformInput, options: PdfImageProviderOptions): PdfImageEngineOperation {
  return {
    op: "addImageEdit",
    attributes: {
      kind: "transformImage",
      pageIndex: pageIndex(input.pageIndex, options.pageOrder),
      oldRect: rect(input.oldRect, "oldRect"),
      rect: rect(input.rect, "rect"),
      ...(input.layer ? { layer: input.layer } : {}),
      ...(input.quarterTurns === undefined ? {} : { quarterTurns: input.quarterTurns }),
    },
  };
}

function submitDelete(input: PdfImageDeleteInput, options: PdfImageProviderOptions): PdfImageEngineOperation {
  const oldRect = rect(input.oldRect, "oldRect");
  return { op: "addImageEdit", attributes: { kind: "deleteImage", pageIndex: pageIndex(input.pageIndex, options.pageOrder), oldRect, rect: oldRect } };
}

async function submitReplace(input: PdfImageReplaceInput, options: PdfImageProviderOptions): Promise<PdfImageEngineOperation> {
  const object = await objectMetadata(options, input.target);
  const oldRect = rect(object.rect, "oldRect");
  return {
    op: "addImageEdit",
    attributes: {
      kind: "replaceImage",
      pageIndex: pageIndex(input.target.page - 1, options.pageOrder),
      oldRect,
      rect: rect(input.rect ?? oldRect, "rect"),
      image: imageBase64(input.image),
      ...(input.layer ?? object.layer ? { layer: input.layer ?? object.layer } : {}),
      ...(input.quarterTurns === undefined ? {} : { quarterTurns: input.quarterTurns }),
    },
  };
}

/** Browser-safe U-4 image provider. It only emits serialisable addImageEdit
 * envelopes; decoding and PDF mutation remain in the host codec/engine. */
export function createPdfImageOperationProvider(options: PdfImageProviderOptions, submitter: PdfImageOperationSubmitter): PdfImageOperationProvider {
  const submit = (operation: PdfImageEngineOperation): Promise<void> | void => submitter.submit([operation]);
  return {
    async insertImage(input) { await submit(submitInsert(input, options)); },
    async transformImage(input) { await submit(submitTransform(input, options)); },
    async replaceImage(input) { await submit(await submitReplace(input, options)); },
    async deleteImage(input) { await submit(submitDelete(input, options)); },
  };
}

import type { PdfOpsBridgeOptions } from "../ops-bridge";

/** PDF user-space placement rectangle: [x1, y1, x2, y2]. */
export type PdfStampRect = [number, number, number, number];

/** Where a stamp lands: the page and its rectangle. `pageIndex` is the
 *  zero-based position in the *current displayed* page order, the same
 *  convention the ink, drawing and image providers use; the provider resolves
 *  it through `pageOrder` to the engine's original zero-based page index. */
export interface PdfStampPlacement {
  pageIndex: number;
  rect: PdfStampRect;
  /** Whole quarter turns applied to the image, clockwise. */
  quarterTurns?: 0 | 90 | 180 | 270;
}

/** A stamp the user can place. `kind` separates a free-form image stamp from a
 *  saved signature; the engine envelope carries both the same way, but the UI
 *  and the picker differ, so the tag is kept rather than inferred. */
export type PdfStampKind = "image" | "signature";

/** One placement request: the stamp's identity plus where it goes. `image` is
 *  base64 with no `data:` prefix, the shape the saved-signature endpoint and
 *  the engine's image operations both speak. */
export interface PdfStampInput {
  kind: PdfStampKind;
  /** Saved-signature id when `kind` is "signature"; omitted for an image stamp. */
  signatureId?: string;
  /** `image/png` or `image/jpeg`. */
  contentType: string;
  /** Image bytes base64-encoded, without the `data:` prefix. */
  image: string;
  placement: PdfStampPlacement;
}

/**
 * The typed engine envelope for a stamp placement (UNI-925 B6). The engine op
 * itself lands later, so this is the seam: the view builds a validated,
 * JSON-serialisable envelope and a host submitter decides how to hand it to
 * office-engine. `op` is `"addStamp"` and `attributes.stamp` carries the
 * resolved placement: `pageIndex` is the engine's original zero-based index,
 * because `pageOrder` is resolved while the envelope is built.
 */
export interface PdfStampEngineOperation {
  op: "addStamp";
  attributes: {
    stamp: {
      kind: PdfStampKind;
      pageIndex: number;
      rect: PdfStampRect;
      contentType: string;
      image: string;
      signatureId?: string;
      quarterTurns?: 0 | 90 | 180 | 270;
    };
  };
}

export interface PdfStampOperationProvider {
  placeStamp(input: PdfStampInput): Promise<void> | void;
}

export interface PdfStampOperationSubmitter {
  submit(operations: readonly PdfStampEngineOperation[]): Promise<void> | void;
}

export type PdfStampProviderOptions = Pick<PdfOpsBridgeOptions, "pageOrder">;

/** A saved signature the palette can place, kept structurally independent of
 *  the endpoint's row so the palette does not depend on the signatures module. */
export interface PdfStampSignatureSource {
  id: string;
  label: string;
  contentType: string;
  /** Base64 with no `data:` prefix. */
  image: string;
}

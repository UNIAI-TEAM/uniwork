import type { SavedSignature } from "@uniwork/core/types/signature";

export type { SavedSignature };

/** A saved signature as the picker consumes it: the list row plus the derived
 *  `data:` URL a thumbnail draws from. The endpoint hands back raw base64 with
 *  no prefix, so the view owns the one place that adds it. */
export interface PdfSignatureThumbnail {
  /** `data:<content_type>;base64,<image>`, or "" when the row has no bytes. */
  dataUrl: string;
  /** True when the row carries no drawable image; the picker shows a glyph. */
  missing: boolean;
}

export interface PdfSavedSignaturePickerProps {
  /**
   * The organization the signatures are scoped to (`/api/v1/orgs/{orgId}/
   * signatures`). Hosts read it from the workspace/org context the editor is
   * already inside (`workspace.organization_id`); it is a prop here so the
   * panel stays independent of any one host's context.
   */
  orgId: string;
  /** The row currently chosen for a placement; drives the pressed state. */
  selectedId?: string | null;
  /** Choose a signature for the pending stamp placement. */
  onSelect?: (signature: SavedSignature) => void;
  /** Read-only host: every control is disabled but stays reachable. */
  disabled?: boolean;
  className?: string;
}

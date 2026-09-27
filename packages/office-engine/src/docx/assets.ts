// DOCX asset inventory — what the package carries beyond body blocks.
// The inventory exists for two contract needs: typed fidelity warnings at
// open (parts the engine preserves but the editor cannot edit), and the
// two-save/preservation oracle (an asset that disappears between inventories
// is a lost relationship, not a refactor).
import type { DocxParsed } from "./engine";
import type { FidelityWarning } from "@uniwork/office-contracts";

export interface DocxAssetInventory {
  /** Inline images (blocks carrying image data) */
  images: number;
  /** Chart parts referenced by chart blocks (extras.chartParts keys) */
  chartParts: string[];
  /** word/fonts embedded faces */
  embeddedFonts: number;
  /** Header/footer display images (logos — preserved, not editable) */
  hfImages: number;
  /** OLE objects / embedded packages detected in blocks */
  oleObjects: number;
  /** Bibliography sources (customXml) */
  sources: number;
  /** Media-bearing part names when the seam can enumerate the package */
  parts?: string[];
}

function countBlocks(parsed: DocxParsed, pred: (b: Record<string, unknown>) => boolean): number {
  return parsed.blocks.filter((b) => pred(b as Record<string, unknown>)).length;
}

/** Build the inventory from the parsed model surface. `parts` is optional —
 * the engine seam may enumerate package part names for a stricter oracle. */
export function inventoryDocxAssets(parsed: DocxParsed, parts?: string[]): DocxAssetInventory {
  const chartParts = Object.keys(parsed.extras?.chartParts ?? {});
  const embeddedFonts = Array.isArray(parsed.embeddedFonts)
    ? (parsed.embeddedFonts as unknown[]).length
    : 0;
  const hfImages =
    (Array.isArray(parsed.headerImages) ? (parsed.headerImages as unknown[]).length : 0) +
    (Array.isArray(parsed.footerImages) ? (parsed.footerImages as unknown[]).length : 0);
  const oleObjects = countBlocks(
    parsed,
    (b) => typeof b.oleProgId === "string" || b.type === "oleObject",
  );
  const sources = Array.isArray(parsed.sources) ? (parsed.sources as unknown[]).length : 0;
  const images = countBlocks(parsed, (b) => b.type === "image" || typeof b.imageDataUrl === "string");
  return {
    images,
    chartParts,
    embeddedFonts,
    hfImages,
    oleObjects,
    sources,
    ...(parts ? { parts } : {}),
  };
}

/** Part-kind buckets for preservation checks on enumerable packages. */
export function docxPartKinds(parts: string[]): Record<string, number> {
  const kinds: Record<string, number> = {};
  for (const p of parts) {
    const bucket = p.startsWith("word/media/")
      ? "media"
      : p.startsWith("word/embeddings/")
        ? "embeddings"
        : p.startsWith("word/charts/")
          ? "charts"
          : p.startsWith("word/fonts/")
            ? "fonts"
            : p.startsWith("customXml/")
              ? "customXml"
              : p.includes("vbaProject")
                ? "vba"
                : "other";
    kinds[bucket] = (kinds[bucket] ?? 0) + 1;
  }
  return kinds;
}

export interface DocxAssetDiff {
  missing: string[];
  added: string[];
}

/** Relationship-preservation oracle between two package snapshots. Any missing
 * media/embedding/chart part is a lost relationship; additions are fine only
 * when an insert intentionally created them. */
export function diffDocxAssets(before: string[], after: string[]): DocxAssetDiff {
  const a = new Set(before);
  const b = new Set(after);
  return {
    missing: [...a].filter((p) => !b.has(p)),
    added: [...b].filter((p) => !a.has(p)),
  };
}

/** Typed open-time warnings (copy-consent surface): constructs the engine
 * preserves untouched but the adapter/editor cannot edit. */
export function unsupportedDocxWarnings(inv: DocxAssetInventory): FidelityWarning[] {
  const warnings: FidelityWarning[] = [];
  if (inv.oleObjects > 0) {
    warnings.push({
      code: "unsupported_construct_preserved",
      detail: inv.oleObjects + " embedded OLE object(s) preserved untouched; not editable in this adapter",
    });
  }
  if (inv.chartParts.length > 0) {
    warnings.push({
      code: "unsupported_construct_preserved",
      detail: inv.chartParts.length + " chart part(s) preserved; chart data not editable here",
    });
  }
  if (inv.embeddedFonts > 0) {
    warnings.push({
      code: "fonts_substituted",
      detail: inv.embeddedFonts + " embedded font face(s); render hosts without them substitute",
    });
  }
  for (const p of inv.parts ?? []) {
    if (/vbaProject|\.bin$/i.test(p) && !warnings.some((w) => w.code === "macro_preserved_not_executed")) {
      warnings.push({
        code: "macro_preserved_not_executed",
        detail: "macro/binary part " + p + " preserved; never executed",
      });
    }
    if (/word\/embeddings\//i.test(p) && !warnings.some((w) => w.code === "unsupported_construct_preserved" && /embeddings/.test(w.detail ?? ""))) {
      warnings.push({
        code: "unsupported_construct_preserved",
        detail: "package embeddings preserved untouched: " + p,
      });
    }
  }
  return warnings;
}

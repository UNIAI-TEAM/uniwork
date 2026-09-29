// PPTX asset inventory — package entries grouped by kind, plus the
// slide→media relationship map from slide rels. Used for open-time typed
// warnings and the two-save relationship oracle (no duplicated media, no
// lost embedded content).
import type { OpenedPptxLike } from "./engine";
import type { FidelityWarning } from "@uniwork/office-contracts";

export interface PptxAssetInventory {
  media: string[];
  slideLayouts: string[];
  slideMasters: string[];
  notesSlides: string[];
  charts: string[];
  embeddings: string[];
  fonts: string[];
  vba: string[];
  mediaRefs: Record<string, string[]>;
  other: string[];
}

function entryNames(archive: OpenedPptxLike["archive"]): string[] {
  const entries = archive?.entries;
  if (!entries) return [];
  if (entries instanceof Map) return [...entries.keys()];
  return Object.keys(entries);
}

/** Media refs declared in a slide's rels part (Relationship Target="..."). */
function relsMediaTargets(archive: OpenedPptxLike["archive"], relsPath: string): string[] {
  const xml = archive?.readText?.(relsPath);
  if (typeof xml !== "string") return [];
  const targets: string[] = [];
  for (const m of xml.matchAll(/Target="([^"]+)"/g)) {
    const t = m[1];
    if (t && /media\//.test(t)) targets.push(t.replace(/^\.\.\//, "ppt/"));
  }
  return targets;
}

/** Inventory the held deck's package. archive.entries is the same surface the
 * upstream PackageArchive exposes (OpenedPptx.archive.entries). */
export function inventoryPptxAssets(opened: OpenedPptxLike): PptxAssetInventory {
  const names = entryNames(opened.archive);
  const inv: PptxAssetInventory = {
    media: [],
    slideLayouts: [],
    slideMasters: [],
    notesSlides: [],
    charts: [],
    embeddings: [],
    fonts: [],
    vba: [],
    mediaRefs: {},
    other: [],
  };
  for (const p of names) {
    if (/^ppt\/media\//.test(p)) inv.media.push(p);
    else if (/^ppt\/slideLayouts\/[^/]*\.xml$/.test(p)) inv.slideLayouts.push(p);
    else if (/^ppt\/slideMasters\/[^/]*\.xml$/.test(p)) inv.slideMasters.push(p);
    else if (/^ppt\/notesSlides\/[^/]*\.xml$/.test(p)) inv.notesSlides.push(p);
    else if (/charts?\//.test(p)) inv.charts.push(p);
    else if (/embeddings\//.test(p)) inv.embeddings.push(p);
    else if (/fonts\//.test(p)) inv.fonts.push(p);
    else if (/vbaProject|\.bin$/i.test(p)) inv.vba.push(p);
    else inv.other.push(p);
  }
  for (const p of names) {
    const m = /^ppt\/slides\/_rels\/(slide\d+)\.xml\.rels$/.exec(p);
    if (m) {
      const refs = relsMediaTargets(opened.archive, p);
      if (refs.length) inv.mediaRefs[m[1] as string] = refs;
    }
  }
  return inv;
}

export interface PptxAssetDiff {
  missing: string[];
  added: string[];
}

/** Relationship-preservation oracle between two inventories (e.g. before vs
 * after a second save): any missing media/embedding/chart part is a lost
 * relationship — additions only make sense alongside an intentional insert. */
export function diffPptxAssets(before: PptxAssetInventory, after: PptxAssetInventory): PptxAssetDiff {
  const flatten = (inv: PptxAssetInventory) => [
    ...inv.media, ...inv.charts, ...inv.embeddings, ...inv.fonts, ...inv.slideMasters, ...inv.slideLayouts,
  ];
  const a = new Set(flatten(before));
  const b = new Set(flatten(after));
  return {
    missing: [...a].filter((p) => !b.has(p)),
    added: [...b].filter((p) => !a.has(p)),
  };
}

/** Typed open-time warnings: constructs preserved untouched that the adapter
 * cannot edit (copy-consent surface — a warning never blocks the open). */
export function unsupportedPptxWarnings(inv: PptxAssetInventory): FidelityWarning[] {
  const warnings: FidelityWarning[] = [];
  if (inv.embeddings.length > 0) {
    warnings.push({
      code: "unsupported_construct_preserved",
      detail: inv.embeddings.length + " embedded package(s) preserved untouched; not editable in this adapter",
    });
  }
  if (inv.charts.length > 0) {
    warnings.push({
      code: "unsupported_construct_preserved",
      detail: inv.charts.length + " chart part(s) preserved; chart data not editable here",
    });
  }
  const av = inv.media.filter((p) => /\.(mp4|mov|wmv|avi|mp3|wav|m4a)$/i.test(p));
  if (av.length > 0) {
    warnings.push({
      code: "unsupported_construct_preserved",
      detail: av.length + " audio/video media preserved; playback is host-side only",
    });
  }
  if (inv.vba.length > 0) {
    warnings.push({
      code: "macro_preserved_not_executed",
      detail: inv.vba.length + " macro/binary part(s) preserved; never executed",
    });
  }
  if (inv.fonts.length > 0) {
    warnings.push({
      code: "fonts_substituted",
      detail: inv.fonts.length + " embedded font part(s); render hosts without them substitute",
    });
  }
  return warnings;
}

"use client";

// G3-04d R1 (UNI-823): the canvas column layout of the DOCX pagination driver.
// Upstream genoffice owns this in its App (colMode / colFlow / measureSingleFlow
// / colGeomsFor, App.tsx:2949-3022 and the injected colFlow CSS at 5606-5613);
// UniWork is the App, so the decision and the CSS it drives live here.
import {
  docCharSpacePt,
  docGridPitchPt,
  sectionBidi,
  sectionColGeom,
  sectionColumns,
  type RendererColumnGeom,
  type RendererSection,
  type RendererSectionGeom,
} from "@uniwork/office-upstream/docs-renderer-editor";

const TWIPS_TO_PX = 96 / 1440;

const twipsToPx = (twips: number): number => twips * TWIPS_TO_PX;

/**
 * How the canvas paints the document's section columns: `uniform` = every
 * section agrees on one equal-width multi-column spec (and the document has no
 * RTL columns, no nextColumn / continuous section break), so whole-page CSS
 * multicol renders it; `mixed` = the sections disagree, so the engine's regions
 * are painted per block; `none` = no multi-column section (single flow).
 */
export type DocxColumnMode = "none" | "uniform" | "mixed";

export function docxColumnMode(sections: RendererSection[]): DocxColumnMode {
  if (sections.length === 0) return "none";
  const canvas = sections[0];
  if (!canvas) return "none";
  if (!sections.some((s) => sectionColumns(s) > 1)) return "none";
  const g0 = sectionColGeom(canvas);
  const uniform =
    !sections.some(sectionBidi) &&
    !sections.some((s, i) => i > 0 && (s.startType === "nextColumn" || s.startType === "continuous")) &&
    sections.every((s) => {
      const g = sectionColGeom(s);
      return (
        g.cols === g0.cols &&
        g.cols > 1 &&
        g.equalWidth &&
        Math.abs(g.colWidthPx - g0.colWidthPx) < 0.5 &&
        Math.abs(g.gapPx - g0.gapPx) < 0.5
      );
    });
  return uniform ? "uniform" : "mixed";
}

/** The uniform-mode column geometry (canvas section), or null in other modes. */
export function docxColumnFlow(sections: RendererSection[]): RendererColumnGeom | null {
  const canvas = sections[0];
  if (!canvas) return null;
  return docxColumnMode(sections) === "uniform" ? sectionColGeom(canvas) : null;
}

/**
 * Column-flow geometry gate (upstream App's colGeomsFor): when the canvas
 * column layout is inactive the measured flow is full-width, so the geometry
 * the slicer consumes must drop `cols` to match.
 */
export function colGeomsFor(geoms: RendererSectionGeom[], mode: DocxColumnMode): RendererSectionGeom[] {
  if (mode !== "none") return geoms;
  for (const geom of geoms) if (geom.cols) geom.cols = undefined;
  return geoms;
}

/**
 * The colFlow style block upstream App injects for the uniform path: the
 * document's real column count/gap on `.doc-page`, and the single-flow
 * measuring state (`measuring-columns`: columns off, width = one column) that
 * the measurement/slice pass reads. `.doc-page` is border-box, so the measured
 * width must add back the left/right margin padding.
 */
export function docxColumnCss(sections: RendererSection[]): string {
  const flow = docxColumnFlow(sections);
  const canvas = sections[0];
  if (!flow || !canvas) return "";
  const margins = twipsToPx(canvas.settings.marginLeft) + twipsToPx(canvas.settings.marginRight);
  return [
    `.editor-scroll .doc-page { column-count: ${flow.cols}; column-gap: ${flow.gapPx}px; column-fill: balance; }`,
    `.editor-scroll .doc-page.measuring-columns { column-count: auto; width: ${flow.colWidthPx + margins}px; }`,
  ].join("\n");
}

/**
 * G3-04d T/R: doc-level variables upstream App sets on the canvas (page
 * margins for page-relative anchors, and the typed docGrid pitch / character
 * spacing the document style rules resolve through).
 */
export function docxDocumentVars(sections: RendererSection[]): Record<string, string> {
  const canvas = sections[0];
  if (!canvas) return {};
  const vars: Record<string, string> = {
    "--doc-margin-left": `${twipsToPx(canvas.settings.marginLeft)}px`,
    "--doc-margin-right": `${twipsToPx(canvas.settings.marginRight)}px`,
    "--doc-margin-top": `${twipsToPx(canvas.settings.marginTop)}px`,
  };
  const pitch = docGridPitchPt(sections);
  if (pitch != null) vars["--doc-grid-pitch"] = `${pitch}pt`;
  const charSpace = docCharSpacePt(sections);
  if (charSpace != null) vars["--doc-char-space"] = `${charSpace}pt`;
  return vars;
}

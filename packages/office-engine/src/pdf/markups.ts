import { PDFArray, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import type { MarkupInput, MarkupType } from "./types.ts";

const SUBTYPE: Record<MarkupType, string> = {
  highlight: "Highlight",
  underline: "Underline",
  strikeout: "StrikeOut",
};

const round = (value: number): number => Math.round(value * 100) / 100;

function quadBounds(quad: number[]): [number, number, number, number] {
  const xs = [quad[0]!, quad[2]!, quad[4]!, quad[6]!];
  const ys = [quad[1]!, quad[3]!, quad[5]!, quad[7]!];
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function appearance(pdfDoc: PDFDocument, markup: MarkupInput, rect: number[], rotation: number) {
  const [r, g, b] = markup.color;
  const commands: string[] = [];
  if (markup.type === "highlight") {
    commands.push("/GsM gs", `${r} ${g} ${b} rg`);
    for (const quad of markup.quads) {
      const [x1, y1, x2, y2] = quadBounds(quad);
      commands.push(`${round(x1)} ${round(y1)} ${round(x2 - x1)} ${round(y2 - y1)} re f`);
    }
  } else {
    commands.push(`${r} ${g} ${b} RG`);
    const offset = markup.type === "underline" ? 0.08 : 0.46;
    for (const quad of markup.quads) {
      const [x1, y1, x2, y2] = quadBounds(quad);
      const height = rotation % 180 === 0 ? y2 - y1 : x2 - x1;
      commands.push(`${Math.max(0.8, round(height * 0.06))} w`);
      if (rotation === 90) {
        const x = x2 - height * offset;
        commands.push(`${round(x)} ${round(y1)} m ${round(x)} ${round(y2)} l S`);
      } else if (rotation === 270) {
        const x = x1 + height * offset;
        commands.push(`${round(x)} ${round(y1)} m ${round(x)} ${round(y2)} l S`);
      } else {
        const y = rotation === 180 ? y2 - height * offset : y1 + height * offset;
        commands.push(`${round(x1)} ${round(y)} m ${round(x2)} ${round(y)} l S`);
      }
    }
  }
  return pdfDoc.context.stream(commands.join("\n"), {
    Type: "XObject",
    Subtype: "Form",
    BBox: rect,
    Resources: markup.type === "highlight"
      ? { ExtGState: { GsM: { Type: "ExtGState", BM: "Multiply", ca: 1 } } }
      : {},
  });
}

function appendAnnotation(pdfDoc: PDFDocument, page: PDFPage, ref: PDFRef): void {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(ref);
  else page.node.set(PDFName.of("Annots"), pdfDoc.context.obj([ref]));
}

export function addMarkup(pdfDoc: PDFDocument, page: PDFPage, markup: MarkupInput): void {
  const bounds = markup.quads.map(quadBounds);
  const rect = [
    Math.min(...bounds.map((q) => q[0])),
    Math.min(...bounds.map((q) => q[1])),
    Math.max(...bounds.map((q) => q[2])),
    Math.max(...bounds.map((q) => q[3])),
  ];
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  const appearanceRef = pdfDoc.context.register(appearance(pdfDoc, markup, rect, rotation));
  const annotation = pdfDoc.context.obj({
    Type: "Annot",
    Subtype: SUBTYPE[markup.type],
    Rect: rect,
    QuadPoints: markup.quads.flat(),
    C: markup.color,
    F: 4,
    T: "UniWork",
    P: page.ref,
    AP: { N: appearanceRef },
  });
  appendAnnotation(pdfDoc, page, pdfDoc.context.register(annotation));
}

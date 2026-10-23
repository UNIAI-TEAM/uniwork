import { PDFArray, PDFDocument, PDFName, PDFRef } from "pdf-lib";
import type { PDFPage } from "pdf-lib";
import type { DrawingInput } from "./types.ts";

const round = (value: number): number => Math.round(value * 100) / 100;
const bounds = (rect: readonly [number, number, number, number], pad: number): [number, number, number, number] => [
  Math.min(rect[0], rect[2]) - pad, Math.min(rect[1], rect[3]) - pad, Math.max(rect[0], rect[2]) + pad, Math.max(rect[1], rect[3]) + pad,
];

function appearance(pdfDoc: PDFDocument, input: DrawingInput, rect: [number, number, number, number]) {
  const [r, g, b] = input.color;
  const commands: string[] = [`${r} ${g} ${b} RG`, `${round(input.width)} w`, "1 J", "1 j"];
  if (input.kind === "ink" && "points" in input.geometry) {
    const points = input.geometry.points;
    if (points.length >= 2) {
      commands.push(`${round(points[0]!.x)} ${round(points[0]!.y)} m`);
      for (const point of points.slice(1)) commands.push(`${round(point.x)} ${round(point.y)} l`);
      commands.push("S");
    }
  } else if ((input.kind === "line" || input.kind === "arrow") && "start" in input.geometry) {
    const { start, end } = input.geometry;
    commands.push(`${round(start.x)} ${round(start.y)} m ${round(end.x)} ${round(end.y)} l S`);
    if (input.kind === "arrow") {
      const dx = end.x - start.x;
      const dy = end.y - start.y;
      const length = Math.hypot(dx, dy) || 1;
      const ux = dx / length;
      const uy = dy / length;
      const size = Math.max(input.width * 3, 6);
      const bx = end.x - ux * size;
      const by = end.y - uy * size;
      const px = -uy * size * 0.45;
      const py = ux * size * 0.45;
      commands.push(`${round(end.x)} ${round(end.y)} m ${round(bx + px)} ${round(by + py)} l ${round(bx - px)} ${round(by - py)} l h f`);
    }
  } else if ("rect" in input.geometry) {
    const x1 = input.geometry.rect.x;
    const y1 = input.geometry.rect.y;
    const x2 = x1 + input.geometry.rect.width;
    const y2 = y1 + input.geometry.rect.height;
    if (input.kind === "rect") {
      if (input.fill) {
        commands.push(`${input.fill[0]} ${input.fill[1]} ${input.fill[2]} rg`, `${round(x1)} ${round(y1)} ${round(x2 - x1)} ${round(y2 - y1)} re f`);
      }
      commands.push(`${round(x1)} ${round(y1)} ${round(x2 - x1)} ${round(y2 - y1)} re S`);
    } else {
      if (input.fill) commands.push(`${input.fill[0]} ${input.fill[1]} ${input.fill[2]} rg`);
      const k = 0.5522848;
      const cx = (x1 + x2) / 2;
      const cy = (y1 + y2) / 2;
      const rx = (x2 - x1) / 2;
      const ry = (y2 - y1) / 2;
      commands.push(
        `${round(cx + rx)} ${round(cy)} m`,
        `${round(cx + rx)} ${round(cy + k * ry)} ${round(cx + k * rx)} ${round(cy + ry)} ${round(cx)} ${round(cy + ry)} c`,
        `${round(cx - k * rx)} ${round(cy + ry)} ${round(cx - rx)} ${round(cy + k * ry)} ${round(cx - rx)} ${round(cy)} c`,
        `${round(cx - rx)} ${round(cy - k * ry)} ${round(cx - k * rx)} ${round(cy - ry)} ${round(cx)} ${round(cy - ry)} c`,
        `${round(cx + k * rx)} ${round(cy - ry)} ${round(cx + rx)} ${round(cy - k * ry)} ${round(cx + rx)} ${round(cy)} c`,
        input.fill ? "B" : "S",
      );
    }
  }
  return pdfDoc.context.stream(commands.join("\n"), { Type: "XObject", Subtype: "Form", BBox: rect });
}

function appendAnnotation(pdfDoc: PDFDocument, page: PDFPage, ref: PDFRef): void {
  const annots = page.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
  if (annots) annots.push(ref);
  else page.node.set(PDFName.of("Annots"), pdfDoc.context.obj([ref]));
}

export function addDrawing(pdfDoc: PDFDocument, page: PDFPage, input: DrawingInput): void {
  const pad = round(input.width) / 2;
  const rect = "rect" in input.geometry
    ? bounds([input.geometry.rect.x, input.geometry.rect.y, input.geometry.rect.x + input.geometry.rect.width, input.geometry.rect.y + input.geometry.rect.height], pad)
    : "start" in input.geometry
      ? bounds([input.geometry.start.x, input.geometry.start.y, input.geometry.end.x, input.geometry.end.y], pad)
    : bounds([Math.min(...input.geometry.points.map((point) => point.x)), Math.min(...input.geometry.points.map((point) => point.y)), Math.max(...input.geometry.points.map((point) => point.x)), Math.max(...input.geometry.points.map((point) => point.y))] as [number, number, number, number], pad);
  const appearanceRef = pdfDoc.context.register(appearance(pdfDoc, input, rect));
  const subtype = input.kind === "rect" ? "Square" : input.kind === "ellipse" ? "Circle" : input.kind === "ink" ? "Ink" : "Line";
  const lineGeometry = "start" in input.geometry ? input.geometry : undefined;
  const inkGeometry = "points" in input.geometry ? input.geometry : undefined;
  const annotation = {
    Type: "Annot", Subtype: subtype, Rect: rect, C: input.color, Border: [0, 0, input.width],
    F: 4, T: "UniWork", P: page.ref, AP: { N: appearanceRef },
    ...(input.fill && (input.kind === "rect" || input.kind === "ellipse") ? { IC: input.fill } : {}),
    ...(lineGeometry && (input.kind === "line" || input.kind === "arrow") ? { L: [lineGeometry.start.x, lineGeometry.start.y, lineGeometry.end.x, lineGeometry.end.y] } : {}),
    ...(input.kind === "arrow" ? { LE: ["None", "OpenArrow"] } : {}),
    ...(inkGeometry && input.kind === "ink" ? { InkList: [inkGeometry.points.map((point) => [point.x, point.y]).flat()] } : {}),
  };
  appendAnnotation(pdfDoc, page, pdfDoc.context.register(pdfDoc.context.obj(annotation)));
}

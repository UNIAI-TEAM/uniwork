import {
  decodeXml,
  ExtractTypedError,
  readAttr,
  relsPathFor,
  resolveZipTarget,
  type SelectiveZip,
} from "./extract-shared.ts";

const NOTES_FURNITURE_PLACEHOLDERS: Readonly<Record<string, true>> = {
  sldNum: true,
  dt: true,
  hdr: true,
  ftr: true,
  sldImg: true,
};

function extractDrawingParas(xml: string): string[] {
  const paras: string[] = [];
  for (const pm of xml.matchAll(/<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/g)) {
    const pBody = pm[1] ?? "";
    const parts: string[] = [];
    const tokenRe = /<(?:\w+:)?(t|br|tab)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?\1>)/g;
    let tm: RegExpExecArray | null;
    while ((tm = tokenRe.exec(pBody)) !== null) {
      const tag = tm[1];
      if (tag === "t") parts.push(decodeXml(tm[3] ?? ""));
      else if (tag === "br") parts.push("\n");
      else if (tag === "tab") parts.push("\t");
    }
    const line = parts.join("");
    if (line.trim()) paras.push(line);
  }
  return paras;
}

function extractPptxNotes(zip: SelectiveZip, slidePath: string): string {
  const sRelsXml = zip.readText(relsPathFor(slidePath));
  if (sRelsXml === null) return "";
  let notesPath: string | null = null;
  for (const m of sRelsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const type = readAttr(attrs, "Type") ?? "";
    const target = readAttr(attrs, "Target") ?? "";
    if (type.endsWith("/notesSlide") && target) {
      notesPath = resolveZipTarget(slidePath, target.trim());
      break;
    }
  }
  if (!notesPath) return "";
  const notesXml = zip.readText(notesPath);
  if (notesXml === null) return "";

  let hasBodyPlaceholder = false;
  const bodyShapes: string[] = [];
  const nonFurnitureShapes: string[] = [];
  for (const spm of notesXml.matchAll(/<(?:\w+:)?sp\b[^>]*>[\s\S]*?<\/(?:\w+:)?sp>/g)) {
    const spXml = spm[0];
    const phMatch = /<(?:\w+:)?ph\b([^>]*?)\/?>/.exec(spXml);
    const phType = phMatch ? (readAttr(phMatch[1] ?? "", "type") ?? "") : undefined;
    if (phType === "body") {
      hasBodyPlaceholder = true;
      bodyShapes.push(...extractDrawingParas(spXml));
    } else if (phType === undefined || (phType !== "" && !NOTES_FURNITURE_PLACEHOLDERS[phType])) {
      nonFurnitureShapes.push(...extractDrawingParas(spXml));
    }
  }
  if (hasBodyPlaceholder) return bodyShapes.join("\n");
  return nonFurnitureShapes.join("\n");
}

export function extractPptx(zip: SelectiveZip): string {
  const presXml = zip.readText("ppt/presentation.xml");
  if (presXml === null) throw new ExtractTypedError("corrupted", "missing ppt/presentation.xml");

  const presRelsXml = zip.readText("ppt/_rels/presentation.xml.rels") ?? "";
  const presRels = new Map<string, string>();
  for (const m of presRelsXml.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const id = readAttr(attrs, "Id");
    const target = readAttr(attrs, "Target");
    if (id && target) presRels.set(id, resolveZipTarget("ppt/presentation.xml", target.trim()));
  }

  const slidePaths: string[] = [];
  for (const m of presXml.matchAll(/<(?:\w+:)?sldId\b([^>]*?)\/?>/g)) {
    const attrs = m[1] ?? "";
    const rId = readAttr(attrs, "r:id") ?? readAttr(attrs, "id");
    if (!rId) {
      throw new ExtractTypedError("corrupted", "slide entry missing relationship id");
    }
    const path = presRels.get(rId);
    if (!path || !zip.has(path)) {
      throw new ExtractTypedError("corrupted", `unresolved slide relationship ${rId}`);
    }
    slidePaths.push(path);
  }
  if (slidePaths.length === 0) {
    throw new ExtractTypedError("corrupted", "presentation has no slides");
  }

  const sections: string[] = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const slidePath = slidePaths[i]!;
    const slideXml = zip.readText(slidePath);
    if (slideXml === null) throw new ExtractTypedError("corrupted", `missing slide ${slidePath}`);
    const paras = extractDrawingParas(slideXml);
    const notes = extractPptxNotes(zip, slidePath);
    const lines = [`## Slide ${i + 1}`, ...paras];
    if (notes) {
      lines.push("Notes:", notes);
    }
    sections.push(lines.join("\n"));
  }
  return sections.join("\n\n");
}

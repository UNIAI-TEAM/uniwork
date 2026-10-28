import {
  decodeXml,
  ExtractTypedError,
  readAttr,
  resolveZipTarget,
  type SelectiveZip,
} from "./extract-shared.ts";

function extractDocxParaText(pXml: string): string {
  const parts: string[] = [];
  const tokenRe = /<(?:\w+:)?(t|tab|br|cr)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?\1>)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(pXml)) !== null) {
    const tag = m[1];
    if (tag === "t") parts.push(decodeXml(m[3] ?? ""));
    else if (tag === "tab") parts.push("\t");
    else if (tag === "br" || tag === "cr") parts.push("\n");
  }
  return parts.join("");
}

export function extractDocx(zip: SelectiveZip): string {
  let docPath = "word/document.xml";
  if (!zip.has(docPath)) {
    const rels = zip.readText("_rels/.rels");
    if (rels !== null) {
      for (const m of rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?>/g)) {
        const attrs = m[1] ?? "";
        const type = readAttr(attrs, "Type") ?? "";
        const target = (readAttr(attrs, "Target") ?? "").trim();
        if (type.endsWith("/officeDocument") && target) {
          docPath = resolveZipTarget("", target);
          break;
        }
      }
    }
  }
  const xml = zip.readText(docPath);
  if (xml === null) throw new ExtractTypedError("corrupted", "missing word/document.xml");
  if (!/<(?:\w+:)?body(?:\s|>|\/>)/.test(xml)) {
    throw new ExtractTypedError("corrupted", "document.xml has no <w:body>");
  }

  const lines: string[] = [];
  const blockRe = /<(?:\w+:)?(tbl|p)\b[^>]*>[\s\S]*?<\/(?:\w+:)?\1>/g;
  let bm: RegExpExecArray | null;
  while ((bm = blockRe.exec(xml)) !== null) {
    const kind = bm[1];
    const blockXml = bm[0];
    if (kind === "tbl") {
      const trRe = /<(?:\w+:)?tr\b[^>]*>([\s\S]*?)<\/(?:\w+:)?tr>/g;
      let trm: RegExpExecArray | null;
      while ((trm = trRe.exec(blockXml)) !== null) {
        const cells: string[] = [];
        const tcRe = /<(?:\w+:)?tc\b[^>]*>([\s\S]*?)<\/(?:\w+:)?tc>/g;
        let tcm: RegExpExecArray | null;
        while ((tcm = tcRe.exec(trm[1] ?? "")) !== null) {
          const cellParas: string[] = [];
          const pRe = /<(?:\w+:)?p\b[^>]*>([\s\S]*?)<\/(?:\w+:)?p>/g;
          let pm: RegExpExecArray | null;
          while ((pm = pRe.exec(tcm[1] ?? "")) !== null) {
            const t = extractDocxParaText(pm[1] ?? "");
            if (t) cellParas.push(t);
          }
          cells.push(cellParas.join(" "));
        }
        lines.push(cells.join(" | "));
      }
    } else {
      const text = extractDocxParaText(blockXml);
      const styleTag = /<(?:\w+:)?pStyle\b([^>]*?)\/?>/.exec(blockXml);
      const styleAttrs = styleTag?.[1] ?? "";
      const styleId = readAttr(styleAttrs, "w:val") ?? readAttr(styleAttrs, "val") ?? "";
      const headingMatch = /^Heading(\d)$/i.exec(styleId);
      if (headingMatch?.[1]) {
        lines.push(`${"#".repeat(Number(headingMatch[1]))} ${text}`);
      } else {
        lines.push(text);
      }
    }
  }
  return lines.join("\n");
}

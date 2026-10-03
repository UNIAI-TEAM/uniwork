// XML scanning helpers shared by the XLSX model readers.
export const decodeXml = (text: string): string =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec), 10))
    .replace(/&amp;/g, "&");

export const attribute = (tag: string, name: string): string | undefined => {
  const match = new RegExp(`\\b${name}="([^"]*)"`).exec(tag);
  return match?.[1];
};

/** All `<name …>body</name>` / `<name …/>` elements, bodies included. */
export function elements(xml: string, name: string): { tag: string; body: string }[] {
  const out: { tag: string; body: string }[] = [];
  const tagName = `(?:[A-Za-z_][\\w.-]*:)?${name}`;
  const pattern = new RegExp(`<${tagName}\\b([^>]*?)(?:/>|>([\\s\\S]*?)</${tagName}>)`, "g");
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(xml)) !== null) {
    out.push({ tag: match[1] ?? "", body: match[2] ?? "" });
  }
  return out;
}

export function sectionInner(xml: string, name: string): string {
  const tagName = `(?:[A-Za-z_][\\w.-]*:)?${name}`;
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)</${tagName}>`);
  return pattern.exec(xml)?.[1] ?? "";
}

// ── Colors ─────────────────────────────────────────────────────────────────

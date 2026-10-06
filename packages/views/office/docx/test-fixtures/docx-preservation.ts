import JSZip from "jszip";
// This fixture oracle is imported only by test suites, never by a production entry.
// eslint-disable-next-line import-x/no-extraneous-dependencies
import { expect } from "vitest";

function assertCoreMetadata(before: Uint8Array, after: Uint8Array) {
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  const source = decoder.decode(before), saved = decoder.decode(after);
  const revision = /<cp:revision(?:\s[^>]*)?>([^<]*)<\/cp:revision>/;
  const oldRevision = source.match(revision)?.[1], newRevision = saved.match(revision)?.[1];
  if (oldRevision !== undefined && /^\d+$/.test(oldRevision)) {
    expect(newRevision, "core.xml revision is numeric").toMatch(/^\d+$/);
    expect(BigInt(newRevision!), "one revision increment per user Save").toBe(BigInt(oldRevision) + 1n);
  } else expect(newRevision).toBe(oldRevision);
  const modified = /<dcterms:modified(?:\s[^>]*)?>([^<]*)<\/dcterms:modified>/;
  if (source.match(modified)) expect(Number.isFinite(Date.parse(saved.match(modified)?.[1] ?? ""))).toBe(true);
  // Keep tags, attributes, whitespace and every other field exact; only values vary.
  const normalize = (xml: string) => xml.replace(
    /(<(?:dcterms:modified|cp:revision)(?:\s[^>]*)?>)[^<]*(<\/(?:dcterms:modified|cp:revision)>)/g,
    "$1__SAVE_METADATA__$2",
  );
  expect(normalize(saved), "other core.xml bytes").toBe(normalize(source));
}

/** Word Save may update modified/revision; untouched OOXML part bytes stay exact. */
export async function assertDocxPartsPreserved(source: Uint8Array, saved: Uint8Array, addedStyle: boolean) {
  if (source.length === saved.length && source.every((byte, index) => byte === saved[index])) return;
  const before = await JSZip.loadAsync(source), after = await JSZip.loadAsync(saved);
  const parts = (zip: JSZip) => Object.values(zip.files).filter((entry) => !entry.dir).map((entry) => entry.name).sort();
  expect(parts(after), "OOXML parts").toEqual(parts(before));
  for (const name of parts(before)) {
    if (name === "word/document.xml" || (addedStyle && name === "word/styles.xml")) continue;
    const oldBytes = await before.file(name)!.async("uint8array"), newBytes = await after.file(name)!.async("uint8array");
    if (name === "docProps/core.xml") assertCoreMetadata(oldBytes, newBytes);
    else expect(newBytes, name).toEqual(oldBytes);
  }
}

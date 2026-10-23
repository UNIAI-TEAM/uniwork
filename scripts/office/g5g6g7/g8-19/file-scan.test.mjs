// G8-19 (UNI-1414) saved-file scan for the machine account name (G8-A01):
// the zip parts are inflated before the search, a PDF's /T strings are
// decoded, short and neutral names are skipped and said so, and every hit
// names its part and offset so the artifact points at the bytes.
import assert from "node:assert/strict";
import os from "node:os";
import { test } from "node:test";
import { deflateRawSync, deflateSync } from "node:zlib";

import { crc32 } from "../fixtures-lib/zip.mjs";
import { machineNames, pdfTitleStrings, readZipParts, scanForNames, scanText } from "./file-scan.mjs";

/** A zip whose entries are DEFLATE-compressed (method 8), as Office writes them. */
function zipDeflate(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, text] of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const raw = Buffer.from(text, "utf8");
    const data = deflateRawSync(raw);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);
    offset += 30 + nameBuf.length + data.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const NAME = "zone17th";

test("readZipParts inflates DEFLATE entries (a raw byte search would miss the name)", () => {
  const zip = zipDeflate([["word/comments.xml", `<w:comments><w:comment w:author="${NAME}"/></w:comments>`]]);
  assert.equal(zip.includes(Buffer.from(NAME)), false, "the test zip must really be compressed");
  const parts = readZipParts(zip);
  assert.deepEqual(parts.map((p) => p.name), ["word/comments.xml"]);
  assert.match(parts[0].data.toString("utf8"), /w:author="zone17th"/);
});

for (const [label, part, xml] of [
  ["xlsx threaded comments", "xl/threadedComments/threadedComment1.xml", `<ThreadedComments><threadedComment personId="{1}"><text>hi ${NAME}</text></threadedComment></ThreadedComments>`],
  ["xlsx persons", "xl/persons/person.xml", `<personList><person displayName="${NAME}" id="{1}" userId="${NAME}" providerId="None"/></personList>`],
  ["docx comments", "word/comments.xml", `<w:comments><w:comment w:id="0" w:author="${NAME}" w:initials="Z"/></w:comments>`],
  ["pptx comment authors", "ppt/commentAuthors.xml", `<p:cmAuthorLst><p:cmAuthor id="1" name="${NAME}" initials="Z"/></p:cmAuthorLst>`],
]) {
  test(`scanForNames finds the name inside the inflated ${label} part and reports part + offset`, () => {
    const zip = zipDeflate([["[Content_Types].xml", "<Types/>"], [part, xml]]);
    const result = scanForNames(zip, [NAME]);
    assert.equal(result.kind, "zip");
    assert.equal(result.hits.length >= 1, true, JSON.stringify(result));
    const hit = result.hits[0];
    assert.equal(hit.name, NAME);
    assert.equal(hit.part, part);
    assert.equal(hit.offset, Buffer.from(xml, "utf8").indexOf(NAME));
    assert.ok(result.commentParts.includes(part), "the comment part is listed as re-read");
    assert.deepEqual(result.parts, ["[Content_Types].xml", part]);
  });
}

test("a clean package has no hits but still lists every part it read", () => {
  const zip = zipDeflate([["word/document.xml", "<w:document>Báo cáo</w:document>"], ["word/comments.xml", '<w:comment w:author="G8 A"/>']]);
  const result = scanForNames(zip, [NAME]);
  assert.deepEqual(result.hits, []);
  assert.deepEqual(result.commentParts, ["word/comments.xml"]);
});

test("the match is case-insensitive and needs a word boundary (no hit inside a longer word)", () => {
  assert.equal(scanText(`author="${NAME.toUpperCase()}"`, [NAME], "payload").length, 1);
  assert.equal(scanText(`xx${NAME}yy`, [NAME], "payload").length, 0);
  assert.equal(scanText(`${NAME}-pc`, [NAME], "payload").length, 1);
});

test("a PDF /T (name) literal is found with the /T offset", () => {
  const pdf = Buffer.from(`%PDF-1.7\n1 0 obj\n<< /Type /Annot /Subtype /Text /T (${NAME}) /Contents (x) >>\nendobj\n%%EOF\n`, "latin1");
  const titles = pdfTitleStrings(pdf);
  assert.deepEqual(titles.map((t) => t.value), [NAME]);
  const result = scanForNames(pdf, [NAME]);
  assert.equal(result.kind, "pdf");
  const tHit = result.hits.find((h) => h.part === "pdf:/T");
  assert.ok(tHit, JSON.stringify(result.hits));
  assert.equal(tHit.offset, pdf.indexOf(Buffer.from("/T (")));
});

test("a PDF /T in UTF-16BE hex and one inside a FlateDecode object stream are decoded and found", () => {
  const hex = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(NAME, "utf16le").swap16()]).toString("hex").toUpperCase();
  const inner = deflateSync(Buffer.from(`<< /Type /Annot /T (${NAME}) >>`, "latin1"));
  const pdf = Buffer.concat([
    Buffer.from(`%PDF-1.7\n1 0 obj\n<< /T <${hex}> >>\nendobj\n2 0 obj\n<< /Length ${inner.length} /Filter /FlateDecode >>\nstream\n`, "latin1"),
    inner,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1"),
  ]);
  const result = scanForNames(pdf, [NAME]);
  const parts = result.hits.map((h) => h.part);
  assert.ok(parts.includes("pdf:/T"), JSON.stringify(result.hits));
  assert.ok(parts.some((p) => p.startsWith("pdf:stream@")), JSON.stringify(result.hits));
});

test("a '/T (' inside an unfiltered stream (font bytes) is not read as an annotation author", () => {
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Length 9 >>\nstream\n#/T((U;m\nendstream\nendobj\n%%EOF\n", "latin1");
  assert.deepEqual(pdfTitleStrings(pdf), []);
  assert.deepEqual(scanForNames(pdf, [NAME]).commentParts, []);
});

test("names shorter than 3 characters and the neutral 'User' are skipped and noted", () => {
  const zip = zipDeflate([["word/comments.xml", '<w:comment w:author="User"/><w:comment w:author="ab"/>']]);
  const result = scanForNames(zip, ["ab", "User", "user", NAME]);
  assert.deepEqual(result.names, [NAME]);
  assert.deepEqual(result.hits, []);
  assert.deepEqual(
    result.skipped.map((s) => [s.name, s.reason]),
    [
      ["ab", "shorter than 3 characters"],
      ["User", "the neutral author constant (fork apps/shell/src/main/uniwork-docs/modules.ts:49)"],
      ["user", "the neutral author constant (fork apps/shell/src/main/uniwork-docs/modules.ts:49)"],
    ],
  );
});

test("machineNames() reads os.userInfo().username, os.hostname(), USER and LOGNAME, dedupes and notes the skipped ones", () => {
  const result = machineNames({
    userInfo: () => ({ username: NAME }),
    hostname: () => "bro.tailnet.example",
    env: { USER: NAME, LOGNAME: "ab", USERNAME: "User" },
  });
  assert.deepEqual(result.names, [NAME, "bro.tailnet.example", "bro"]);
  assert.deepEqual(result.sources[NAME], ["os.userInfo().username", "USER"]);
  assert.deepEqual(result.sources.bro, ["os.hostname() (short)"]);
  assert.deepEqual(result.skipped.map((s) => s.name), ["ab", "User"]);
});

test("machineNames() defaults to the real os.userInfo() and os.hostname()", () => {
  const { names, skipped } = machineNames();
  const all = [...names, ...skipped.map((s) => s.name)];
  assert.ok(all.includes(os.userInfo().username));
  assert.ok(all.includes(os.hostname()));
});

// AC-1 cases of the `brand` check (G7-06 contract 2.4): clean rendered text
// passes; each spelling of the old brand names and a blank render fail.
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { runBrandCheck } from "../brand-check.mjs";
import { HOSTS } from "../job-lib.mjs";
import * as fx from "../test-fixtures/capture-fixtures.mjs";
import { FAKE_CAPTURE } from "../test-fixtures/fake-capture.mjs";
import { ONE, outDir, readJson, tmpDir } from "../test-fixtures/test-env.mjs";


function brandWorld({
  text = null,
  hostText = null,
  shellText = null,
  removeText = null,
  metaText = null,
  meta = null,
  forkSha = FAKE_CAPTURE.forkSha,
  pinVersion = FAKE_CAPTURE.pinVersion,
} = {}) {
  const captures = fx.mkCaptures(tmpDir("g7-06-captures-"));
  if (text !== null) writeFileSync(join(captures, "desktop", `${ONE}.txt`), text);
  if (hostText !== null) writeFileSync(join(captures, "desktop", `${ONE}.host.txt`), hostText);
  if (shellText !== null) writeFileSync(join(captures, "desktop", `${ONE}.shell.txt`), shellText);
  if (removeText) {
    for (const host of HOSTS) rmSync(join(captures, host, `${removeText}.txt`), { force: true });
  }
  if (metaText !== null) writeFileSync(join(captures, "desktop", "meta.json"), metaText);
  if (meta) {
    for (const host of HOSTS) {
      const file = join(captures, host, "meta.json");
      const current = readJson(file);
      const next = typeof meta === "function" ? meta(current, host) : { ...current, ...meta };
      if (next === null) rmSync(file, { force: true });
      else writeFileSync(file, `${JSON.stringify(next, null, 2)}\n`);
    }
  }
  const dir = outDir("brand");
  const check = runBrandCheck({ capturesDir: captures, fixtures: [ONE], outDir: dir, forkSha, pinVersion });
  return { check, artifact: readJson(join(dir, "brand.json")), captures };
}

test("brand: clean rendered text passes", () => {
  const { check } = brandWorld();
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
  assert.ok(check.artifacts.includes("brand.json"));
});

for (const [name, hit] of [["camel case", "GenOffice"], ["a zero-width character", "Gen\u200BOffice"], ["upper case", "GENSPARK"], ["a hyphen", "gen-office"]]) {
  test(`brand: ${name} in the rendered text is brand_text`, () => {
    const { check, artifact } = brandWorld({ text: `Báo cáo doanh thu quý 1 — tổng hợp theo khu vực.\n${hit}\n` });
    assert.equal(check.status, "FAIL");
    assert.deepEqual(check.reasons, [`brand_text:desktop/${ONE}/${ONE}.txt`]);
    const pair = artifact.pairs.find((candidate) => candidate.host === "desktop");
    assert.equal(pair.hits.length, 1);
    assert.ok(pair.hits[0].context.includes(pair.hits[0].brand), pair.hits[0].context);
  });
}

for (const [name, hit] of [["a Greek omicron", "GenΟffice"], ["a Cyrillic е", "Gеnoffice"], ["a Cyrillic ѕ", "Genѕpark"], ["fullwidth letters", "ＧｅｎＯｆｆｉｃｅ"]]) {
  test(`brand: ${name} in the rendered text is brand_text`, () => {
    const { check, artifact } = brandWorld({ text: `Báo cáo doanh thu quý 1 — tổng hợp theo khu vực.\n${hit}\n` });
    assert.equal(check.status, "FAIL");
    assert.deepEqual(check.reasons, [`brand_text:desktop/${ONE}/${ONE}.txt`]);
    const pair = artifact.pairs.find((candidate) => candidate.host === "desktop");
    assert.equal(pair.hits.length, 1);
  });
}

for (const [name, hit] of [["a combining acute that composes with n", "Ge\u006E\u0301office"], ["a combining circumflex that composes with o", "Geno\u0302ffice"], ["a combining mark on a letter with no precomposed form", "Genof\u0301fice"]]) {
  test(`brand: ${name} cannot hide the brand (F-1)`, () => {
    const { check } = brandWorld({ text: `Báo cáo doanh thu quý 1 — tổng hợp theo khu vực.\n${hit}\n` });
    assert.equal(check.status, "FAIL");
    assert.ok(check.reasons.every((reason) => reason.startsWith("brand_text:")), JSON.stringify(check.reasons));
  });
}

test("brand: Vietnamese text with its own diacritics still passes after the mark strip", () => {
  const { check } = brandWorld({ text: "Tổng hợp doanh thu quý một của khu vực Đồng bằng sông Cửu Long — cần được phê duyệt.\n" });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
});

test("brand: Cyrillic and Greek text that spells no brand still passes", () => {
  const { check } = brandWorld({ text: "Ký tự Hy Lạp và Kirin trong tài liệu: αβγδ абвгд настройки, không có nhãn cũ.\n" });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
});

test("brand: an empty or near-empty render is no_rendered_text", () => {
  const empty = brandWorld({ text: "" });
  assert.equal(empty.check.status, "FAIL");
  assert.deepEqual(empty.check.reasons, ["no_rendered_text"]);
  const short = brandWorld({ text: "quá ngắn" });
  assert.equal(short.check.status, "FAIL");
  assert.deepEqual(short.check.reasons, ["no_rendered_text"]);
});

test("brand: a missing .txt is BLOCKED for that pair", () => {
  const { check } = brandWorld({ removeText: ONE });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["rendered_text_missing"]);
});

test("brand: no captures at all is BLOCKED", () => {
  const dir = outDir("brand-none");
  const check = runBrandCheck({ capturesDir: join(tmpDir("g7-06-nocaptures-"), "captures"), fixtures: [ONE], outDir: dir });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["captures_missing"]);
});

test("brand: a meta.json that is not valid JSON is BLOCKED, never a crash", () => {
  const { check } = brandWorld({ metaText: "{ not json" });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["capture_meta_unreadable"]);
});

test("brand: captures from another build are BLOCKED, never scanned", () => {
  const other = brandWorld({ meta: { pinVersion: "0.1.0-other" } });
  assert.equal(other.check.status, "BLOCKED");
  assert.deepEqual(other.check.reasons, ["captures_from_another_pin"]);
});

test("brand: a host without meta.json is BLOCKED, not treated as ok", () => {
  const { check } = brandWorld({ meta: () => null });
  assert.equal(check.status, "BLOCKED");
  assert.deepEqual(check.reasons, ["capture_meta_missing"]);
});


const CLEAN = "Báo cáo doanh thu quý 1 — tổng hợp theo khu vực.\n";

for (const [name, option, file] of [["host page", "hostText", "host.txt"], ["shell window titles", "shellText", "shell.txt"]]) {
  test(`brand: a brand string only in the ${name} text is brand_text naming ${file}`, () => {
    const { check, artifact } = brandWorld({ [option]: `${CLEAN}GenSpark\n` });
    assert.equal(check.status, "FAIL");
    assert.deepEqual(check.reasons, [`brand_text:desktop/${ONE}/${ONE}.${file}`]);
    const pair = artifact.pairs.find((candidate) => candidate.host === "desktop");
    assert.equal(pair.hits.length, 1);
    assert.equal(pair.hits[0].file, `${ONE}.${file}`);
  });
}

test("brand: a blank .txt with a populated .host.txt is still no_rendered_text", () => {
  const { check } = brandWorld({ text: "", hostText: CLEAN });
  assert.equal(check.status, "FAIL");
  assert.deepEqual(check.reasons, ["no_rendered_text"]);
});

test("brand: clean .host.txt and .shell.txt pass", () => {
  const { check } = brandWorld({ hostText: CLEAN, shellText: CLEAN });
  assert.equal(check.status, "PASS", JSON.stringify(check.reasons));
});

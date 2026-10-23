// UNI-667 narrow node:test for the PPTX image evidence oracle and the deterministic image
// fixture builder. Every case builds its deck in memory through the real builder, runs the
// real on-disk oracle over real bytes, and needs no browser and no engine process. The only
// disk use is a fresh scratch tree this file owns.
//   node --test scripts/office-g0/pptx-image-evidence.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  AUTHORED_NAME,
  AUTHORED_PIXEL,
  CONTROL,
  CONTROL_PIXEL,
  FIXTURE_NAME,
  PRESERVED_PARTS,
  REPLACEMENT_NAME,
  REPLACEMENT_PIXEL,
  SECOND_TEXT,
  TABLE,
  TARGET,
  TITLE_TEXT,
  assertContained,
  buildPptxImageFixture,
  fixtureExpectations,
  generatorRgbSha256,
  loadFixtureDeps,
  main as builderMain,
  planWrites,
  resolveWriteOutcome,
  writeOutputs,
} from "./create-pptx-image-fixture.mjs";
import {
  PptxImageError,
  assessPptxImageBytes,
  authoredImageEvidence,
  decodePngRgb,
  readPictureRecords,
  readZipParts,
  sha256,
  verifyPptxImageOutput,
} from "./pptx-image-evidence.mjs";

/**
 * The prepared source holds the builder's dependency (jszip). A missing dependency fails
 * HERE by name rather than as a cast hole later.
 */
const depsDir = (process.env.OFFICE_G0_PPTX_FIXTURE_DEPS ?? "").trim();
if (depsDir.length === 0) {
  throw new Error(
    "OFFICE_G0_PPTX_FIXTURE_DEPS must name the prepared source holding node_modules (e.g. .uniwork-dev/office-g0/bootstrap-source)",
  );
}
const deps = loadFixtureDeps(depsDir);
const build = () => buildPptxImageFixture({ JSZip: deps.JSZip });
const SIZE = 16;

/** A named failure from the oracle: assert the CODE, never the human message text. */
const codedError = (code) => (error) => {
  assert.ok(
    error instanceof PptxImageError,
    "expected a PptxImageError, saw " + String(error && error.name) + ": " + String(error && error.message),
  );
  assert.equal(error.code, code, "exact failure code");
  return true;
};
const builderCode = (code) => (error) => {
  assert.equal(error && error.code, code, "exact builder failure code");
  return true;
};

/** The descriptor set the oracle consumes, with the AUTHORED/CONTROL pixel generators used as truth. */
const expectedFor = (fixtureSha) =>
  fixtureExpectations(
    {
      authored: { width: SIZE, height: SIZE, rgbSha256: generatorRgbSha256(SIZE, AUTHORED_PIXEL) },
      control: { width: SIZE, height: SIZE, rgbSha256: generatorRgbSha256(SIZE, CONTROL_PIXEL) },
      replacement: { width: SIZE, height: SIZE, rgbSha256: generatorRgbSha256(SIZE, REPLACEMENT_PIXEL) },
    },
    fixtureSha,
  );

const scratch = mkdtempSync(join(tmpdir(), "pptx-image-evidence-"));
test.after(() => rmSync(scratch, { recursive: true, force: true }));

/**
 * Builds the wrong-target output on purpose: the authored deck with the CONTROL picture
 * (pic#4) pointed at the replacement bytes instead of the target. This is a real OOXML edit
 * of the same shape the engine performs, so the oracle is exercised against a genuine
 * wrong-target package rather than a hypothetical flag.
 */
async function replaceControlInsteadOfTarget(built) {
  const { JSZip } = deps;
  const zip = await JSZip.loadAsync(built.fixtureBytes);
  zip.file("ppt/media/image2.png", built.replacementBytes);
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

/**
 * A REAL OOXML replacement save, of the shape the engine performs: a NEW media part, a NEW
 * relationship for it, and the target picture's own <a:blip r:embed> repointed at that new
 * relationship while the authored media part drops out of the package. Everything else - the
 * control picture, both slide parts' unrelated content, the table, the theme, the master and the
 * layout - is carried over untouched, so it is the honest positive control for the preservation
 * gates rather than a hand-built expectation.
 */
async function applyReplacementSave(built, { mutate } = {}) {
  const { JSZip } = deps;
  const zip = await JSZip.loadAsync(built.fixtureBytes);
  zip.file("ppt/media/image3.png", built.replacementBytes);
  const relsPath = "ppt/slides/_rels/slide1.xml.rels";
  let rels = await zip.file(relsPath).async("string");
  rels = rels.replace(
    "</Relationships>",
    '<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/image3.png"/></Relationships>',
  );
  zip.file(relsPath, rels);
  let slide1 = await zip.file(TARGET.part).async("string");
  // Repoint ONLY the target picture's blip, located at that picture's own cNvPr id.
  const targetBlock = slide1.match(/<p:pic>[\s\S]*?<p:cNvPr id="3"[\s\S]*?<\/p:pic>/);
  assert.ok(targetBlock, "the authored target picture must be locatable");
  slide1 = slide1.replace(targetBlock[0], targetBlock[0].replace(/r:embed="rId2"/, 'r:embed="rId4"'));
  zip.file(TARGET.part, mutate ? mutate(slide1) : slide1);
  zip.remove("ppt/media/image1.png");
  return Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
}

const readFileSafe = (target) => {
  try {
    return readFileSync(target);
  } catch {
    return null;
  }
};

test("decodePngRgb decodes the builder's PNG and rejects a non-PNG by name", async () => {
  const built = await build();
  const png = decodePngRgb(built.replacementBytes, "replacement");
  assert.equal(png.width, SIZE);
  assert.equal(png.height, SIZE);
  assert.equal(png.channels, 3);
  assert.equal(png.colorType, 2);
  assert.equal(png.bitDepth, 8);
  assert.equal(png.rgb.length, SIZE * SIZE * 3, "the decoded RGB buffer is exposed for pixel comparison");
  assert.equal(png.rgbSha256, generatorRgbSha256(SIZE, REPLACEMENT_PIXEL), "decoded pixels match the generator");
  // A real decode, not a copy of the container bytes.
  assert.notEqual(sha256(png.rgb), png.sha256);

  assert.throws(() => decodePngRgb(Buffer.from("not a png at all"), "junk"), codedError("not_a_png"));
  assert.throws(() => decodePngRgb(Buffer.alloc(0), "empty"), codedError("not_a_png"));
  assert.throws(() => decodePngRgb(built.replacementBytes.subarray(0, 12), "cut"), codedError("png_no_ihdr"));
});

test("the builder is deterministic and its three pixel patterns are distinct", async () => {
  const first = await build();
  const second = await build();
  assert.equal(sha256(first.fixtureBytes), sha256(second.fixtureBytes), "deck bytes are byte-identical across builds");
  assert.equal(sha256(first.replacementBytes), sha256(second.replacementBytes), "replacement bytes are byte-identical");
  const digests = new Set([
    generatorRgbSha256(SIZE, AUTHORED_PIXEL),
    generatorRgbSha256(SIZE, CONTROL_PIXEL),
    generatorRgbSha256(SIZE, REPLACEMENT_PIXEL),
  ]);
  assert.equal(digests.size, 3, "authored, control and replacement pixels must all differ");
});

test("readPictureRecords resolves each picture's OWN relationship to its OWN media part", async () => {
  const built = await build();
  const records = readPictureRecords(readZipParts(built.fixtureBytes), TARGET.part);
  assert.equal(records.length, 2, "slide 1 carries exactly two pictures");
  const target = records.find((r) => r.id === TARGET.id);
  const control = records.find((r) => r.id === CONTROL.id);
  assert.ok(target && control);
  assert.equal(target.mediaPart, "ppt/media/image1.png");
  assert.equal(control.mediaPart, "ppt/media/image2.png");
  assert.notEqual(target.embed, control.embed, "each picture keeps its own relationship id");
  assert.deepEqual(target.geometry, { x: 5029200, y: 731520, cx: 1828800, cy: 1371600 });
});

test("assessPptxImageBytes rejects an unchanged package as stale output, never a pass", async () => {
  const built = await build();
  const expected = expectedFor(sha256(built.fixtureBytes));
  const report = assessPptxImageBytes({
    fixtureBytes: built.fixtureBytes,
    savedBytes: built.fixtureBytes,
    replacementBytes: built.replacementBytes,
    expected,
  });
  assert.equal(report.ok, false);
  assert.equal(report.gates.savedDiffersFromFixture, false);
  assert.ok(report.reasons.some((r) => r.code === "stale_output"), "an unchanged package is named stale_output");
});

test("assessPptxImageBytes refuses an unknown target identity and names an unchanged target", async () => {
  const built = await build();
  const right = expectedFor(sha256(built.fixtureBytes));
  const run = (expected) =>
    assessPptxImageBytes({
      fixtureBytes: built.fixtureBytes,
      savedBytes: built.fixtureBytes,
      replacementBytes: built.replacementBytes,
      expected,
    });
  // A target id that exists nowhere on the slide is a HARD refusal: the oracle never falls
  // back to another picture, so a wrong identity cannot be credited by accident.
  assert.throws(() => run({ ...right, target: { part: TARGET.part, kind: "pic", id: 99 } }), codedError("fixture_target_not_unique"));
  // The REAL wrong-target result: a saved deck whose CONTROL picture (pic#4) was replaced
  // instead of the target (pic#3). The oracle must refuse it, never credit the wrong picture.
  const wrongTargetBytes = await replaceControlInsteadOfTarget(built);
  const wrongTarget = assessPptxImageBytes({
    fixtureBytes: built.fixtureBytes,
    savedBytes: wrongTargetBytes,
    replacementBytes: built.replacementBytes,
    expected: right,
  });
  assert.equal(wrongTarget.ok, false, "replacing the control picture must never pass as the target");
  assert.equal(wrongTarget.gates.targetEmbedChanged, false, "the target blip is untouched");
  assert.ok(wrongTarget.reasons.some((r) => r.code === "wrong_image_target"), "credited as wrong_image_target");
  // ...and the control gate fires too, because the control really did lose its media bytes.
  assert.ok(wrongTarget.reasons.some((r) => r.code === "lost_unrelated_object"));
  // With the RIGHT identity but an unchanged saved deck, the target gate is what names the
  // wrong-image/no-op result - a returned report (not a throw), with wrong_image_target present.
  const unchanged = run(right);
  assert.equal(unchanged.ok, false);
  assert.equal(unchanged.gates.targetEmbedChanged, false);
  assert.equal(unchanged.gates.targetMediaIsReplacementBytes, false);
  assert.ok(unchanged.reasons.some((r) => r.code === "wrong_image_target"), "an unchanged blip is named wrong_image_target");
  assert.ok(unchanged.reasons.some((r) => r.code === "replacement_bytes_mismatch"));
});

test("authoredImageEvidence returns the negative preflight and refuses a foreign fixture hash", async () => {
  const built = await build();
  const fixturePath = join(scratch, FIXTURE_NAME);
  writeFileSync(fixturePath, built.fixtureBytes);
  const preflight = authoredImageEvidence(fixturePath, expectedFor(sha256(built.fixtureBytes)), built.replacementBytes);
  assert.equal(preflight.authoredTargetContract.ok, true, "the authored deck satisfies the AUTHORED contract");
  assert.equal(preflight.authoredTargetContract.rgbSha256, generatorRgbSha256(SIZE, AUTHORED_PIXEL));
  // The negative flag is the reason this helper exists. Without it the gate could read green on
  // an authored-as-saved package with no test noticing, which is exactly the hole the review named.
  assert.equal(
    preflight.authoredFailsReplacementContract,
    true,
    "the authored bytes must FAIL the replacement contract the saved output is credited with",
  );
  // Withheld replacement bytes must stay null. A free true here would credit an authored-only
  // comparison that never saw the replacement PNG.
  const expected = expectedFor(sha256(built.fixtureBytes));
  for (const withheld of [
    authoredImageEvidence(fixturePath, expected),
    authoredImageEvidence(fixturePath, expected, null),
  ]) {
    assert.equal(withheld.authoredTargetContract.ok, true);
    assert.equal(
      withheld.authoredFailsReplacementContract,
      null,
      "withholding replacement bytes must leave the flag null, not a free true",
    );
  }
  assert.throws(
    () => authoredImageEvidence(fixturePath, expectedFor("0".repeat(64)), built.replacementBytes),
    codedError("fixture_hash_mismatch"),
  );
});

test("verifyPptxImageOutput refuses a missing or malformed input by name", () => {
  assert.throws(() => verifyPptxImageOutput({}), codedError("bad_input_api"));
  assert.throws(
    () => verifyPptxImageOutput({ fixturePath: "a", savedPath: "", reopenedPath: "c", replacementPath: "d" }),
    codedError("bad_input_api"),
  );
});

test("a real replacement save passes every gate, and the preservation gates are NOT vacuous", async () => {
  const built = await build();
  const savedBytes = await applyReplacementSave(built);
  const report = assessPptxImageBytes({
    fixtureBytes: built.fixtureBytes,
    savedBytes,
    replacementBytes: built.replacementBytes,
    expected: expectedFor(sha256(built.fixtureBytes)),
  });
  assert.equal(report.ok, true, "a genuine replacement save must be credited: " + JSON.stringify(report.failed));
  // The declared list is real, and the oracle reports it back so a green boolean can never stand
  // in for "zero parts compared".
  assert.equal(PRESERVED_PARTS.length > 0, true, "the builder declares a non-empty preserved list");
  assert.equal(report.gates.preservedPartsDeclared, true);
  assert.equal(report.gates.preservedPartsByteEqual, true);
  assert.equal(report.preservedParts.length, PRESERVED_PARTS.length, "every declared part was actually compared");
  assert.deepEqual(report.preservedParts.map((entry) => entry.part), [...PRESERVED_PARTS]);
  assert.equal(report.preservedParts.every((entry) => entry.present && entry.byteEqual), true);
  // The unrelated table is a real claim too, not an unclaimed null.
  assert.equal(report.gates.tableContentMatches, true);
  assert.deepEqual(report.table.cells, [...TABLE.cells]);
});

test("an empty preserved-part list is REFUSED by name, never a vacuous green", async () => {
  const built = await build();
  const savedBytes = await applyReplacementSave(built);
  const report = assessPptxImageBytes({
    fixtureBytes: built.fixtureBytes,
    savedBytes,
    replacementBytes: built.replacementBytes,
    expected: { ...expectedFor(sha256(built.fixtureBytes)), preservedParts: [] },
  });
  assert.equal(report.gates.preservedPartsDeclared, false, "an undeclared list is a failed gate, not `[].every` true");
  assert.equal(report.gates.preservedPartsByteEqual, false);
  assert.equal(report.ok, false);
  assert.ok(report.reasons.some((r) => r.code === "preserved_parts_undeclared"), "named preserved_parts_undeclared");
});

test("collateral damage to a preserved part or the unrelated table is caught by name", async () => {
  const built = await build();
  const expected = expectedFor(sha256(built.fixtureBytes));
  // Rewriting an unrelated part (here the slide master) while the replacement contract still
  // holds exactly: without the part-byte gate this would be an invisible green.
  const { JSZip } = deps;
  const zip = await JSZip.loadAsync(await applyReplacementSave(built));
  const master = await zip.file("ppt/slideMasters/slideMaster1.xml").async("string");
  zip.file("ppt/slideMasters/slideMaster1.xml", master.replace("</p:sldMaster>", "<p:extLst/></p:sldMaster>"));
  const damagedMaster = Buffer.from(await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" }));
  const masterReport = assessPptxImageBytes({
    fixtureBytes: built.fixtureBytes,
    savedBytes: damagedMaster,
    replacementBytes: built.replacementBytes,
    expected,
  });
  assert.equal(masterReport.ok, false, "a rewritten unrelated part must never pass");
  assert.equal(masterReport.gates.preservedPartsByteEqual, false);
  assert.ok(masterReport.reasons.some((r) => r.code === "lost_unrelated_part"), "named lost_unrelated_part");
  // Deleting the unrelated TABLE from the target slide while both text rows and the replacement
  // contract survive: only the table gate can see it.
  const sansTable = await applyReplacementSave(built, { mutate: (xml) => xml.replace(/<p:graphicFrame>[\s\S]*?<\/p:graphicFrame>/, "") });
  const tableReport = assessPptxImageBytes({
    fixtureBytes: built.fixtureBytes,
    savedBytes: sansTable,
    replacementBytes: built.replacementBytes,
    expected,
  });
  assert.equal(tableReport.ok, false, "a deleted unrelated table must never pass");
  assert.equal(tableReport.gates.tableContentMatches, false);
  // The target slide part is deliberately NOT in preservedParts (the replacement rewrites its
  // blip), so the part-byte gate stays green here: the table gate is the ONLY detector for this
  // collateral damage, which is exactly why a declared table has to be compared cell by cell.
  assert.equal(tableReport.gates.preservedPartsByteEqual, true);
  assert.equal(tableReport.gates.preservedTargetsMatch, true, "both unrelated text rows survive");
  assert.ok(tableReport.reasons.some((r) => r.code === "lost_unrelated_object"), "named lost_unrelated_object");
});

test("a stale reopen and a mutated fixture are caught when real readers are injected", async () => {
  const built = await build();
  const savedBytes = await applyReplacementSave(built);
  const expected = expectedFor(sha256(built.fixtureBytes));
  const drifted = assessPptxImageBytes({
    fixtureBytes: built.fixtureBytes,
    savedBytes,
    replacementBytes: built.replacementBytes,
    expected,
    readSavedBytes: () => Buffer.concat([savedBytes, Buffer.from("drift")]),
  });
  assert.equal(drifted.gates.savedStableAfterFreshReopen, false, "a drifting reopen is not credited");
  assert.ok(drifted.reasons.some((r) => r.code === "reopen_drift"));
  const mutated = assessPptxImageBytes({
    fixtureBytes: built.fixtureBytes,
    savedBytes,
    replacementBytes: built.replacementBytes,
    expected,
    readFixtureBytes: () => Buffer.concat([built.fixtureBytes, Buffer.from("touched")]),
  });
  assert.equal(mutated.gates.fixtureUnchangedAfterRun, false, "a mutated authored fixture is not credited");
  assert.ok(mutated.reasons.some((r) => r.code === "fixture_mutated"));
});

test("writeOutputs is honest about checkOnly and reuses or refuses existing bytes", async () => {
  const built = await build();
  const out = join(scratch, "writes");
  const fixture = join(out, FIXTURE_NAME);
  const checkOnly = await writeOutputs([{ path: fixture, bytes: built.fixtureBytes }], { checkOnly: true });
  assert.equal(checkOnly[0].written, false, "checkOnly must never claim a write");
  assert.equal(readFileSafe(fixture), null, "checkOnly must not create the file");

  const written = await writeOutputs([{ path: fixture, bytes: built.fixtureBytes }], {});
  assert.equal(written[0].written, true);
  const again = await writeOutputs([{ path: fixture, bytes: built.fixtureBytes }], {});
  assert.equal(again[0].written, false, "identical bytes are reused");
  assert.equal(again[0].reused, true);
  await assert.rejects(
    () => writeOutputs([{ path: fixture, bytes: Buffer.from("other") }], {}),
    builderCode("existing_output_differs"),
  );
});

test("planWrites observes no I/O and resolveWriteOutcome refuses a differing file", async () => {
  const built = await build();
  const out = join(scratch, "plan");
  const target = join(out, FIXTURE_NAME);
  const plan = planWrites([{ path: target, bytes: built.fixtureBytes }], { checkOnly: false });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].outcome.written, false);
  assert.equal(plan[0].outcome.wouldWrite, true);
  assert.equal(readFileSafe(target), null, "planWrites must not write anything");

  const missing = resolveWriteOutcome(null, built.fixtureBytes, target);
  assert.equal(missing.written, true);
  const identical = resolveWriteOutcome(built.fixtureBytes, built.fixtureBytes, target);
  assert.equal(identical.written, false);
  assert.equal(identical.reused, true);
  assert.throws(() => resolveWriteOutcome(built.fixtureBytes, Buffer.from("x"), target), builderCode("existing_output_differs"));
});

test("assertContained refuses a path outside the authorized root", () => {
  const root = join(scratch, "root");
  mkdirSync(root, { recursive: true });
  assert.equal(assertContained(root, join(root, "a.pptx"), "fixture"), join(root, "a.pptx"));
  assert.throws(() => assertContained(root, join(scratch, "escape.pptx"), "fixture"), builderCode("path_outside_workspace"));
});

test("the real builder entrypoint writes all three outputs and honors its hash pins", async () => {
  const out = join(scratch, "entry");
  const built = await build();
  const fixtureSha = sha256(built.fixtureBytes);
  const replacementSha = sha256(built.replacementBytes);
  const result = await builderMain(
    [
      "--deps", depsDir,
      "--workspace", scratch,
      "--out", out,
      "--expected-sha256", fixtureSha,
      "--expected-replacement-sha256", replacementSha,
    ],
    { ...process.env, OFFICE_G0_WORKSPACE: scratch },
  );
  assert.equal(result.fixture.sha256, fixtureSha);
  assert.equal(result.replacement.sha256, replacementSha);
  for (const name of [FIXTURE_NAME, REPLACEMENT_NAME, AUTHORED_NAME]) {
    assert.ok(readFileSafe(join(out, name)), name + " must be written by the real entrypoint");
  }
  await assert.rejects(
    () => builderMain(["--deps", depsDir, "--workspace", scratch, "--out", out, "--expected-sha256", "0".repeat(64)], {}),
    builderCode("fixture_hash_mismatch"),
  );
});

test("the fixture's text, pictures and relation topology are stable", async () => {
  const built = await build();
  const parts = readZipParts(built.fixtureBytes);
  const slide1 = parts.get(TARGET.part).toString("utf8");
  const slide2 = parts.get("ppt/slides/slide2.xml").toString("utf8");
  assert.ok(slide1.includes(TITLE_TEXT));
  assert.ok(slide2.includes(SECOND_TEXT));
  assert.ok(slide1.includes('name="Target image"') && slide1.includes('name="Control image"'));
  assert.ok(slide1.includes("<p:graphicFrame>"), "the unrelated table rides on the same slide");
  assert.ok(!slide1.includes("creationId"), "no creationId, so the persisted identity is the cNvPr id");
});

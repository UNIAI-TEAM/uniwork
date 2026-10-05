// UNI-927 X1 - the panel read-backs: transition + advance time, the animation
// timeline (R2-1, R2-2) and notes held outside a body placeholder (R2-3). The
// real-engine round trips live in apps/web/platform/office/pptx-runtime.real.test.ts.
import { describe, expect, it } from "vitest";
import { createPptxAdapter, readPptxSlideAnimations, readPptxSlideTransition, type OpenedPptxLike } from "../src/pptx";
import { readPptxNotesWithoutBodyPlaceholder } from "../src/pptx/notes-read";
import { createFakePptxOps } from "./fake-pptx-engine";
import { makeFakePptxBytes } from "./fake-pptx-fixtures";

const suffix = (inner: string) => "</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>" + inner + "</p:sld>";
const effect = (attrs: string, body: string) =>
  `<p:par><p:cTn id="9" ${attrs}><p:stCondLst><p:cond delay="${/delay=(\d+)/.exec(attrs)?.[1] ?? "0"}"/></p:stCondLst><p:childTnLst>${body}</p:childTnLst></p:cTn></p:par>`;
const timing = (effects: string) =>
  `<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"><p:childTnLst><p:seq><p:cTn id="2" dur="indefinite" nodeType="mainSeq"><p:childTnLst>${effects}</p:childTnLst></p:cTn></p:seq></p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
const target = (spid: number, dur: number, extra = "") => `<p:animEffect><p:cBhvr><p:cTn id="5" dur="${dur}"${extra}/><p:tgtEl><p:spTgt spid="${spid}"/></p:tgtEl></p:cBhvr></p:animEffect>`;
const element = (id: string, spid: number) => ({ id, type: "shape", anchor: { originalXml: `<p:sp><p:nvSpPr><p:cNvPr id="${spid}" name="x"/></p:nvSpPr></p:sp>` } });

describe("readPptxSlideTransition", () => {
  it("reads none, a kind with advTm, an advTm-only timer, morph and an unmodeled effect", () => {
    expect(readPptxSlideTransition(undefined)).toEqual({ kind: "none", advanceMs: null });
    expect(readPptxSlideTransition({ bodySuffix: suffix("") })).toEqual({ kind: "none", advanceMs: null });
    expect(readPptxSlideTransition({ bodySuffix: suffix('<p:transition advTm="2500"><p:fade/></p:transition>') })).toEqual({ kind: "fade", advanceMs: 2500 });
    expect(readPptxSlideTransition({ bodySuffix: suffix('<p:transition advTm="4000"/>') })).toEqual({ kind: "none", advanceMs: 4000 });
    const morph = '<mc:AlternateContent xmlns:mc="m"><mc:Choice Requires="p159"><p:transition advTm="10"><p159:morph option="byObject"/></p:transition></mc:Choice><mc:Fallback><p:transition advTm="10"><p:fade/></p:transition></mc:Fallback></mc:AlternateContent>';
    expect(readPptxSlideTransition({ bodySuffix: suffix(morph) })).toEqual({ kind: "morph", advanceMs: 10 });
    expect(readPptxSlideTransition({ bodySuffix: suffix('<p:transition><p:checker/></p:transition>') })).toEqual({ kind: "none", advanceMs: null });
  });
});

describe("readPptxSlideAnimations", () => {
  it("returns [] without a timing or a main sequence", () => {
    expect(readPptxSlideAnimations(undefined)).toEqual([]);
    expect(readPptxSlideAnimations({ bodySuffix: suffix("<p:timing/>") })).toEqual([]);
    expect(readPptxSlideAnimations({ bodySuffix: suffix('<p:timing><p:tnLst><p:par><p:cTn id="1" nodeType="tmRoot"/></p:par></p:tnLst></p:timing>') })).toEqual([]);
  });

  it("reads effects, triggers, durations, delays and the element of each spid", () => {
    const effects = [
      effect('presetID="10" presetClass="entr" presetSubtype="0" nodeType="clickEffect"', target(2, 500)),
      effect('presetID="23" presetClass="entr" presetSubtype="16" nodeType="afterEffect" delay=700', target(3, 400)),
      effect('presetID="26" presetClass="emph" presetSubtype="0" nodeType="withEffect" delay=900', target(3, 300, ' autoRev="1"')),
      effect('presetID="1" presetClass="exit" presetSubtype="0" nodeType="clickEffect"', target(9, 1)),
      effect('presetID="22" presetClass="entr" presetSubtype="4"', target(2, 500)),
      effect('presetID="0" presetClass="path" presetSubtype="0"', target(2, 2000)),
      effect('presetID="77" presetClass="exit" presetSubtype="0"', target(2, 500)),
      effect('presetID="77" presetClass="emph" presetSubtype="0"', target(2, 500)),
      effect('presetID="77" presetClass="entr" presetSubtype="0"', target(2, 500)),
      effect('presetID="10" presetClass="entr"', "<p:set/>"),
    ].join("");
    const read = readPptxSlideAnimations({ bodySuffix: suffix(timing(effects)), elements: [element("a", 2), element("b", 3), { id: "c", type: "pic" }] });
    expect(read.map(({ spid, elementId, effect: kind, trigger, durationMs, delayMs }) => [spid, elementId, kind, trigger, durationMs, delayMs])).toEqual([
      [2, "a", "fade", "onClick", 500, 0],
      [3, "b", "zoom", "afterPrev", 400, 200],
      [3, "b", "pulse", "withPrev", 600, 200],
      [9, null, "disappear", "onClick", 0, 0],
      [2, "a", "wipeDown", "onClick", 500, 0],
      [2, "a", "motionPath", "onClick", 2000, 0],
      [2, "a", "fadeOut", "onClick", 500, 0],
      [2, "a", "pulse", "onClick", 500, 0],
      [2, "a", "fade", "onClick", 500, 0],
    ]);
  });
});

/** An archive view over plain strings (the real one is the vendored PackageArchive). */
const archiveOf = (files: Record<string, string>) => ({ readText: (path: string) => files[path] });
const rels = (target: string) => `<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="${target}"/></Relationships>`;
const notesXml = (shapes: string) => `<p:notes><p:cSld><p:spTree>${shapes}</p:spTree></p:cSld></p:notes>`;
const sp = (ph: string, paragraphs: string) => `<p:sp><p:nvSpPr><p:cNvPr id="2" name="n"/><p:cNvSpPr/><p:nvPr>${ph}</p:nvPr></p:nvSpPr><p:txBody><a:bodyPr/>${paragraphs}</p:txBody></p:sp>`;

describe("readPptxNotesWithoutBodyPlaceholder", () => {
  const slide = "ppt/slides/slide1.xml";
  it("reads the first non-placeholder text shape of a notes part without a body placeholder", () => {
    const archive = archiveOf({
      "ppt/slides/_rels/slide1.xml.rels": rels("../notesSlides/notesSlide1.xml"),
      "ppt/notesSlides/notesSlide1.xml": notesXml(
        sp('<p:ph type="sldImg"/>', "<a:p><a:r><a:t>image</a:t></a:r></a:p>") +
        sp("", "<a:p></a:p>") +
        sp("", "<a:p><a:r><a:t>Ghi chú &amp; &lt;b&gt; &#x1F600;&#65;</a:t></a:r></a:p><a:p><a:r><a:t>dòng hai</a:t></a:r></a:p><a:p></a:p>"),
      ),
    });
    expect(readPptxNotesWithoutBodyPlaceholder(archive, slide)).toBe("Ghi chú & <b> \u{1F600}A\ndòng hai");
  });

  it("answers '' when the part has a body placeholder, no notes, no rels or an absolute target", () => {
    const withBody = archiveOf({
      "ppt/slides/_rels/slide1.xml.rels": rels("/ppt/notesSlides/notesSlide1.xml"),
      "ppt/notesSlides/notesSlide1.xml": notesXml(sp('<p:ph type="body" idx="1"/>', "<a:p></a:p>") + sp("", "<a:p><a:r><a:t>old</a:t></a:r></a:p>")),
    });
    expect(readPptxNotesWithoutBodyPlaceholder(withBody, slide)).toBe("");
    expect(readPptxNotesWithoutBodyPlaceholder(archiveOf({}), slide)).toBe("");
    expect(readPptxNotesWithoutBodyPlaceholder(undefined, slide)).toBe("");
    expect(readPptxNotesWithoutBodyPlaceholder(archiveOf({ "ppt/slides/_rels/slide1.xml.rels": "<Relationships/>" }), slide)).toBe("");
    expect(readPptxNotesWithoutBodyPlaceholder(archiveOf({ "ppt/slides/_rels/slide1.xml.rels": rels("./x/../../notesSlides/n.xml") }), slide)).toBe("");
    const emptyShapes = archiveOf({ "ppt/slides/_rels/slide1.xml.rels": rels("../notesSlides/n.xml"), "ppt/notesSlides/n.xml": notesXml('<p:sp><p:nvSpPr><p:nvPr/></p:nvSpPr></p:sp>' + sp("", "<a:p></a:p>")) });
    expect(readPptxNotesWithoutBodyPlaceholder(emptyShapes, slide)).toBe("");
  });
});

describe("PptxAdapter live-slide reads (X1)", () => {
  const notesArchive = archiveOf({
    "ppt/slides/_rels/slide1.xml.rels": rels("../notesSlides/notesSlide1.xml"),
    "ppt/notesSlides/notesSlide1.xml": notesXml(sp("", "<a:p><a:r><a:t>Fallback note</a:t></a:r></a:p>")),
  });
  const opened: OpenedPptxLike = {
    deck: { slides: [{ path: "ppt/slides/slide1.xml", bodySuffix: suffix('<p:transition advTm="1500"><p:push dir="u"/></p:transition>' + timing(effect('presetID="10" presetClass="entr"', target(2, 500)))), elements: [element("el-1", 2)] }] },
    archive: notesArchive,
  };
  const open = async (getSlideNotes?: (archive: unknown, path: string) => string) => {
    const adapter = createPptxAdapter({
      engine: { openPptx: async () => opened, savePptx: async () => new Uint8Array([1]), ...(getSlideNotes ? { getSlideNotes } : {}) },
      ops: createFakePptxOps(),
    });
    const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "reads" });
    if (out.outcome !== "opened") throw new Error("open failed");
    return { adapter, ref: out.document_model_ref };
  };

  it("reads the transition and the animations of a live slide, refusing a missing one", async () => {
    const { adapter, ref } = await open(() => "");
    expect(adapter.slideTransition(ref, 0)).toEqual({ kind: "push", advanceMs: 1500 });
    expect(adapter.slideAnimations(ref, 0)).toEqual([{ spid: 2, elementId: "el-1", effect: "fade", trigger: "onClick", durationMs: 500, delayMs: 0 }]);
    expect(() => adapter.slideTransition(ref, 3)).toThrow(/slideTransition: slide index 3/);
    expect(() => adapter.slideAnimations(ref, -1)).toThrow(/slideAnimations: slide index -1/);
  });

  it("falls back to the placeholder-less notes shape only when the vendored read is empty", async () => {
    const empty = await open(() => "");
    expect(empty.adapter.slideNotes(empty.ref, 0)).toBe("Fallback note");
    const vendored = await open(() => "Body note");
    expect(vendored.adapter.slideNotes(vendored.ref, 0)).toBe("Body note");
    const unbound = await open();
    expect(() => unbound.adapter.slideNotes(unbound.ref, 0)).toThrow(/notes_unbound|no speaker-notes read/);
  });
});

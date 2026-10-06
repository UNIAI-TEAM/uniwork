import { describe, expect, it } from "vitest";
import { isSlideHidden, readSlideHidden } from "../src/pptx";

const NS = 'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"';
const prefix = (attrs: string, rest = "") => `<?xml version="1.0"?><p:sld ${NS}${attrs}>${rest}`;

describe("readSlideHidden", () => {
  it("is true for show=\"0\" on the <p:sld> open tag", () => {
    expect(readSlideHidden(prefix(' show="0"'))).toBe(true);
  });

  it("is tolerant of single quotes, attribute order and spacing", () => {
    expect(readSlideHidden(prefix(" show='0'"))).toBe(true);
    expect(readSlideHidden(`<p:sld show="0" ${NS}>`)).toBe(true);
    expect(readSlideHidden(`<p:sld ${NS}\n  show = "0"\n>`)).toBe(true);
    expect(readSlideHidden(`<p:sld ${NS} showMasterSp="1" show="0">`)).toBe(true);
  });

  it("is false for show=\"1\", an absent attribute, or no prefix", () => {
    expect(readSlideHidden(prefix(' show="1"'))).toBe(false);
    expect(readSlideHidden(prefix(""))).toBe(false);
    expect(readSlideHidden("")).toBe(false);
    expect(readSlideHidden(undefined)).toBe(false);
    expect(readSlideHidden("no xml here show=\"0\"")).toBe(false);
  });

  it("ignores lookalike attributes and text outside the open tag", () => {
    expect(readSlideHidden(prefix(' data-show="0"'))).toBe(false);
    expect(readSlideHidden(prefix(' xshow="0"'))).toBe(false);
    expect(readSlideHidden(prefix(' name="a show=&quot;0&quot;"'))).toBe(false);
    expect(readSlideHidden(prefix(' name=\'x show="0"\''))).toBe(false);
    expect(readSlideHidden(prefix("", '<p:cSld show="0"><p:spTree/></p:cSld>'))).toBe(false);
    expect(readSlideHidden(prefix("", '<a:t> show="0" </a:t>'))).toBe(false);
  });

  it("does not mistake <p:sldId> or <p:sldLayout> for the slide tag", () => {
    expect(readSlideHidden('<p:sldId id="256" show="0"/>')).toBe(false);
    expect(readSlideHidden(`<p:sldLayout ${NS} show="0">`)).toBe(false);
  });
});

describe("isSlideHidden", () => {
  it("honours an explicit hidden flag or the prefix", () => {
    expect(isSlideHidden({ hidden: true })).toBe(true);
    expect(isSlideHidden({ bodyPrefix: prefix(' show="0"') })).toBe(true);
    expect(isSlideHidden({ hidden: false, bodyPrefix: prefix("") })).toBe(false);
    expect(isSlideHidden({})).toBe(false);
  });
});

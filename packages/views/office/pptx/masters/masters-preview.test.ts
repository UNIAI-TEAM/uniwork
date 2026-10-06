import { describe, expect, it } from "vitest";
import type { SvgNode } from "../canvas/svg-node";
import { buildMasterPreview, MASTER_BOX_SPACE_WIDTH_PX } from "./masters-preview";
import type { MasterElementView } from "./masters-model";

const t = (key: string) => "[" + key + "]";
const page = { widthPx: MASTER_BOX_SPACE_WIDTH_PX * 2, heightPx: 1080 };
const ELEMENTS: MasterElementView[] = [
  { id: "e_2", type: "shape", label: "title", placeholder: "title", box: { x: 48, y: 24, w: 384, h: 96 }, fill: null },
  { id: "e_3", type: "shape", label: "shape: Brand", box: { x: 0, y: 500, w: 960, h: 40 }, fill: "#1F4E79", text: "Brand\nline two" },
];

const texts = (node: SvgNode): string[] => [...(node.text !== undefined ? [node.text] : []), ...(node.children ?? []).flatMap(texts)];
const groups = (root: SvgNode) => root.children ?? [];
const rect = (group: SvgNode) => group.children?.find((child) => child.tag === "rect");

describe("buildMasterPreview (MAJOR-2)", () => {
  it("draws every element of the part, scaled from the engine box space onto the page", () => {
    const content = buildMasterPreview({ elements: ELEMENTS, selectedId: null, page, t });
    expect(content.widthPx).toBe(page.widthPx);
    expect(content.heightPx).toBe(page.heightPx);
    expect(content.root.attrs?.["data-pptx-master-preview"]).toBe("true");
    const [title, band] = groups(content.root);
    expect(title?.attrs?.["data-master-element-id"]).toBe("e_2");
    expect(title?.attrs?.transform).toBe("translate(96 48)");
    expect(rect(title!)?.attrs).toMatchObject({ width: 768, height: 192, fill: "none", "stroke-dasharray": "6 4" });
    expect(band?.attrs?.transform).toBe("translate(0 1000)");
    expect(rect(band!)?.attrs).toMatchObject({ fill: "#1F4E79" });
    expect(rect(band!)?.attrs?.["stroke-dasharray"]).toBeUndefined();
  });

  it("labels a placeholder by its localized slot and a text element by its text", () => {
    const content = buildMasterPreview({ elements: ELEMENTS, selectedId: null, page, t });
    const [title, band] = groups(content.root);
    expect(texts(title!)).toEqual(["[masters.placeholder_title]"]);
    expect(texts(band!)).toEqual(["Brand line two"]);
  });

  it("names the slot under a placeholder that shows its own text", () => {
    const withText: MasterElementView = { ...ELEMENTS[0]!, text: "Click to edit Master title style" };
    const [title] = groups(buildMasterPreview({ elements: [withText], selectedId: null, page, t }).root);
    expect(texts(title!)).toEqual(["Click to edit Master title style", "[masters.placeholder_title]"]);
  });

  it("draws in ink for the white page, never the theme's muted foreground (F2)", () => {
    const [title, band] = groups(buildMasterPreview({ elements: ELEMENTS, selectedId: null, page, t }).root);
    const textClasses = (group: SvgNode) => (group.children ?? []).filter((child) => child.tag === "text").map((child) => child.attrs?.class);
    // No fill: page ink; the dark #1F4E79 band: inverse ink.
    expect(textClasses(title!)).toEqual(["fill-office-page-ink"]);
    expect(textClasses(band!)).toEqual(["fill-office-page-ink-inverse"]);
    expect(rect(title!)?.attrs?.class).toBe("stroke-office-page-ink-muted");
    const empty = buildMasterPreview({ elements: [], selectedId: null, page, t }).root;
    expect(empty.children?.[0]?.attrs?.class).toBe("fill-office-page-ink");
    // A light solid fill keeps the dark ink.
    const light: MasterElementView = { ...ELEMENTS[1]!, id: "e_9", fill: "#FFE699" };
    const [lightGroup] = groups(buildMasterPreview({ elements: [light], selectedId: null, page, t }).root);
    expect(textClasses(lightGroup!)).toEqual(["fill-office-page-ink"]);
    // Only semantic tokens: no theme foreground (wrong on the white page) and no palette colour.
    const all = JSON.stringify(buildMasterPreview({ elements: ELEMENTS, selectedId: null, page, t }).root);
    expect(all).not.toContain("muted-foreground");
    expect(all).not.toMatch(/(fill|stroke)-(neutral|zinc|slate|gray|white|black)/);
  });

  it("draws the text style the part holds: scaled size, weight, italic, colour (master_fix3 #2)", () => {
    const styled: MasterElementView = { ...ELEMENTS[0]!, style: { sizePt: 40, bold: true, italic: true, color: "#AA0000" } };
    const [title] = groups(buildMasterPreview({ elements: [styled], selectedId: null, page, t }).root);
    const label = title!.children?.find((child) => child.tag === "text");
    // 40 pt at the engine box space, page = 2x the space -> 80 px.
    expect(label?.attrs).toMatchObject({ "font-size": 80, "font-weight": "bold", "font-style": "italic", fill: "#AA0000" });
    // The part's colour replaces the ink class (a class would beat the fill attribute).
    expect(label?.attrs?.class).toBeUndefined();
    // Italic switched off and no colour: normal style, page ink kept, size from the box heuristic.
    const plain: MasterElementView = { ...ELEMENTS[0]!, style: { italic: false } };
    const [unstyled] = groups(buildMasterPreview({ elements: [plain], selectedId: null, page, t }).root);
    const plainLabel = unstyled!.children?.find((child) => child.tag === "text");
    expect(plainLabel?.attrs).toMatchObject({ "font-style": "normal", class: "fill-office-page-ink" });
    expect(plainLabel?.attrs?.["font-size"]).toBe(22);
    expect(plainLabel?.attrs?.fill).toBeUndefined();
  });

  it("marks the selected element", () => {
    const [title, band] = groups(buildMasterPreview({ elements: ELEMENTS, selectedId: "e_2", page, t }).root);
    expect(title?.attrs?.["data-selected"]).toBe("true");
    expect(rect(title!)?.attrs).toMatchObject({ class: "stroke-primary", "stroke-width": 2 });
    expect(band?.attrs?.["data-selected"]).toBeUndefined();
  });

  it("says so when the part has no elements", () => {
    const content = buildMasterPreview({ elements: [], selectedId: null, page, t });
    expect(texts(content.root)).toEqual(["[masters.elements_empty]"]);
  });
});

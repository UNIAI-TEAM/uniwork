// add_connector (R4fix-connector-engine, UNI-927): the builder binds the
// vendored addConnector one-to-one, refuses bad input by typed code, and the
// model applies it as one revision. The real-engine p:cxnSp/stCxn/endCxn +
// undo proof lives in apps/web/platform/office/pptx-runtime.real.test.ts.
import { describe, expect, it } from "vitest";
import { buildConnectorOps, createPptxAdapter, type OpenedPptxLike } from "../src/pptx";
import { createFakePptxEngine, createFakePptxOps } from "./fake-pptx-engine";
import { makeFakePptxBytes } from "./fake-pptx-fixtures";

const opened = {
  deck: { slides: [{ elements: [{ id: "a", type: "shape" }, { id: "b", type: "shape" }] }] },
} as unknown as OpenedPptxLike;

const codeOf = (fn: () => unknown): string => {
  try {
    fn();
  } catch (error) {
    return String((error as { code?: string }).code);
  }
  return "";
};

describe("add_connector", () => {
  it("builds the exact vendored addConnector op", () => {
    expect(buildConnectorOps(opened, 960, { op: "add_connector", slideIndex: 0, elementIds: ["a", "b"], kind: "elbow", arrow: "both" })).toEqual([
      { op: "addConnector", target: { slide: 0 }, from: "a", to: "b", kind: "elbow", arrow: "both" },
    ]);
    expect(buildConnectorOps(opened, 960, { op: "add_connector", slideIndex: 0, elementIds: ["a", "b"] })).toEqual([
      { op: "addConnector", target: { slide: 0 }, from: "a", to: "b" },
    ]);
  });

  it("refuses bad input with typed codes", () => {
    const build = (edit: Record<string, unknown>) => () =>
      buildConnectorOps(opened, 960, { op: "add_connector", slideIndex: 0, elementIds: ["a", "b"], ...edit } as never);
    expect(codeOf(build({ slideIndex: 3 }))).toBe("conn_no_slide");
    expect(codeOf(build({ elementIds: ["a"] }))).toBe("conn_no_element");
    expect(codeOf(build({ elementIds: ["a", "zz"] }))).toBe("conn_no_element");
    expect(codeOf(build({ elementIds: ["a", "a"] }))).toBe("conn_same_element");
    expect(codeOf(build({ kind: "zigzag" }))).toBe("conn_bad_kind");
    expect(codeOf(build({ arrow: "start" }))).toBe("conn_bad_arrow");
  });

  it("applies through the model as one revision and surfaces the created connector id", async () => {
    const adapter = createPptxAdapter({ engine: createFakePptxEngine(), ops: createFakePptxOps() });
    const out = await adapter.open({ bytes: makeFakePptxBytes(), format: "pptx", document_id: "conn" });
    if (out.outcome !== "opened") throw new Error("open failed");
    const model = adapter.sessionOf(out.document_model_ref).model;
    const result = model.applyEdit({ op: "add_connector", slideIndex: 0, elementIds: ["t1", "s1"], kind: "straight" });
    expect(result.applied).toBe(true);
    expect(typeof result.createdId).toBe("string");
    expect(model.revision).toBe(1);
    const created = model.slides[0]?.elements.find((el) => el.id === result.createdId);
    expect(created).toMatchObject({ type: "connector", stCxn: "t1", endCxn: "s1" });
  });
});

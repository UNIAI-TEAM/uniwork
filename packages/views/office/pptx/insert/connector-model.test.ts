// UNI-939 T02/T03 - the connector pane's pure model: line choice, sides, the two edits.
import { describe, expect, it } from "vitest";
import { PPTX_CONNECTOR_DASHES, connectorInsertEdit, connectorLineOf, connectorRequestLine, connectorSideOf, connectorStrokeEdit, type PptxConnectorLineChoice } from "./connector-model";
import { validateConnectorRequest, type PptxInsertConnectorRequest } from "./insert-model";

const base: PptxConnectorLineChoice = { color: "#000000", widthPt: "1", dash: "solid" };

describe("connector line choice", () => {
  it("is invalid for a bad colour or a non-positive / non-numeric width", () => {
    expect(connectorLineOf(base)).toEqual({ color: "#000000", widthPt: 1, dash: "solid" });
    expect(connectorLineOf({ ...base, widthPt: "0" })).toBeNull();
    expect(connectorLineOf({ ...base, widthPt: "-2" })).toBeNull();
    expect(connectorLineOf({ ...base, widthPt: "abc" })).toBeNull();
    expect(connectorLineOf({ ...base, widthPt: "" })).toBeNull();
    expect(connectorLineOf({ ...base, color: "red" })).toBeNull();
  });

  it("sends no line at the default look, so the vendored 1pt black stroke applies", () => {
    expect(connectorRequestLine(base)).toBeUndefined();
    expect(connectorRequestLine({ ...base, widthPt: "not a number" })).toBeUndefined();
  });

  it("sends colour, EMU width and a non-solid dash once any of them changes", () => {
    expect(connectorRequestLine({ color: "#c00000", widthPt: "3", dash: "dash" })).toEqual({ color: "#C00000", widthEmu: 38100, dash: "dash" });
    expect(connectorRequestLine({ ...base, widthPt: "2.5" })).toEqual({ color: "#000000", widthEmu: 31750 });
    expect(connectorRequestLine({ ...base, dash: "sysDot" })).toEqual({ color: "#000000", widthEmu: 12700, dash: "sysDot" });
  });

  it("offers only dashes the vendored connectorLine accepts", () => {
    expect(PPTX_CONNECTOR_DASHES).not.toContain("lgDashDotDot");
    expect(PPTX_CONNECTOR_DASHES).toContain("solid");
  });
});

describe("connector sides", () => {
  it("auto sends no side; the rest pin that end", () => {
    expect(connectorSideOf("auto")).toBeUndefined();
    expect(connectorSideOf("top")).toBe("top");
    expect(connectorSideOf("right")).toBe("right");
    expect(connectorSideOf("bottom")).toBe("bottom");
    expect(connectorSideOf("left")).toBe("left");
  });
});

describe("connector edits", () => {
  const request: PptxInsertConnectorRequest = { slideIndex: 2, from: "a", to: "b", kind: "elbow", arrow: "both" };

  it("builds add_connector with only the optional fields the request carries", () => {
    expect(connectorInsertEdit(request)).toEqual({ op: "add_connector", slideIndex: 2, elementIds: ["a", "b"], kind: "elbow", arrow: "both" });
    const line = { color: "#C00000", widthEmu: 38100, dash: "dash" };
    expect(connectorInsertEdit({ ...request, fromSide: "bottom", toSide: "top", line })).toEqual({
      op: "add_connector",
      slideIndex: 2,
      elementIds: ["a", "b"],
      kind: "elbow",
      arrow: "both",
      fromSide: "bottom",
      toSide: "top",
      line,
    });
  });

  it("builds set_stroke for an existing connector and refuses an invalid line", () => {
    expect(connectorStrokeEdit(1, "c1", { color: "#00AA00", widthPt: "2", dash: "dot" })).toEqual({
      op: "set_stroke",
      slideIndex: 1,
      elementId: "c1",
      stroke: { color: "#00AA00", widthEmu: 25400, dash: "dot" },
    });
    expect(connectorStrokeEdit(1, "c1", base).stroke).toEqual({ color: "#000000", widthEmu: 12700 });
    expect(() => connectorStrokeEdit(1, "c1", { ...base, widthPt: "0" })).toThrow();
  });

  it("never lets an existing connector be an endpoint", () => {
    const elements = [
      { id: "a", type: "shape" },
      { id: "b", type: "shape" },
      { id: "c1", type: "shape", connector: true },
    ];
    expect(validateConnectorRequest({ ...request, from: "a", to: "b" }, elements)).toEqual({ ok: true });
    expect(validateConnectorRequest({ ...request, from: "a", to: "c1" }, elements).ok).toBe(false);
  });
});

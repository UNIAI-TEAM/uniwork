import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import viLocale from "@uniwork/core/i18n/locales/vi.json";
import { XlsxFrameNotices } from "../xlsx-frame-notices";
import { RuleSetDropNotice } from "./rule-set-drop-notice";
import { XLSX_RULE_SETS_DROPPED, type XlsxDroppedRuleSet } from "./rule-set-drops";

function lookup(key: string): string {
  return key.split(".").reduce<unknown>((node, part) => (node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined), viLocale) as string;
}

const editorOf = (drops: readonly XlsxDroppedRuleSet[]) => ({ droppedRuleSets: () => drops });
const BASE = "office.xlsx.conditionalFormat.dropped.";

describe("RuleSetDropNotice", () => {
  it("renders nothing for other codes", () => {
    const { container } = render(<RuleSetDropNotice errorCode="engine_timeout" editor={editorOf([{ family: "dataValidations", sheet: "S" }])} />);
    expect(container).toBeEmptyDOMElement();
    const none = render(<RuleSetDropNotice errorCode={null} editor={editorOf([])} />);
    expect(none.container).toBeEmptyDOMElement();
  });

  it("names the family and sheet of each drop, sheet text stays literal", () => {
    render(<RuleSetDropNotice errorCode={XLSX_RULE_SETS_DROPPED} editor={editorOf([{ family: "conditionalFormats", sheet: "<b>Sales</b>" }, { family: "dataValidations", sheet: "Data" }])} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveAttribute("data-testid", "xlsx-rule-set-dropped");
    expect(alert).toHaveTextContent(lookup(`${BASE}title`));
    expect(alert).toHaveTextContent(`${lookup(`${BASE}familyConditionalFormats`)}: trang tính <b>Sales</b>`);
    expect(alert).toHaveTextContent(`${lookup(`${BASE}familyDataValidations`)}: trang tính Data`);
    expect(alert.querySelector("b")).toBeNull();
    expect(alert).toHaveTextContent(lookup(`${BASE}saveAgain`));
  });

  it("shows the generic text for an empty or missing list", () => {
    const { rerender } = render(<RuleSetDropNotice errorCode={XLSX_RULE_SETS_DROPPED} editor={editorOf([])} />);
    expect(screen.getByRole("alert")).toHaveTextContent(lookup(`${BASE}title`));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
    rerender(<RuleSetDropNotice errorCode={XLSX_RULE_SETS_DROPPED} editor={{}} />);
    expect(screen.getByRole("alert")).toHaveTextContent(lookup(`${BASE}saveAgain`));
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("caps the list at 10 with a +N more line", () => {
    const drops = Array.from({ length: 13 }, (_, index) => ({ family: "conditionalFormats" as const, sheet: `S${index}` }));
    render(<RuleSetDropNotice errorCode={XLSX_RULE_SETS_DROPPED} editor={editorOf(drops)} />);
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(screen.getByRole("alert")).toHaveTextContent("và 3 mục khác");
    expect(screen.getByRole("alert")).not.toHaveTextContent("S10");
  });
});

describe("XlsxFrameNotices pass-through", () => {
  const base = { recalcProgress: null, recalcError: null, editFailed: false, onCancelRecalculate: () => undefined };
  it("renders the drop notice for the dropped code only", () => {
    const { rerender } = render(<XlsxFrameNotices {...base} saveErrorCode={XLSX_RULE_SETS_DROPPED} editor={editorOf([{ family: "dataValidations", sheet: "Q" }])} />);
    expect(screen.getByTestId("xlsx-rule-set-dropped")).toHaveTextContent("trang tính Q");
    rerender(<XlsxFrameNotices {...base} saveErrorCode="other" editor={editorOf([])} />);
    expect(screen.queryByTestId("xlsx-rule-set-dropped")).toBeNull();
  });
});

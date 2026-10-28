import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { applyLabelKey, bodyArg, formatProposalValue } from "./ask-uni-proposal-values";

const i18n = initI18n();
const t = i18n.t.bind(i18n);
const fmt = (v: string, type: string, field: string) => formatProposalValue(v, type, field, t, "vi");

describe("formatProposalValue for Office files", () => {
  it("labels visibility, location and format", () => {
    expect(fmt("restricted", "enum", "visibility")).toBe("Chỉ mình tôi");
    expect(fmt("workspace", "enum", "visibility")).toBe("Cả workspace");
    expect(fmt("my_folder", "enum", "location")).toBe("Thư mục của tôi");
    expect(fmt("pptx", "enum", "format")).toBe("PPTX");
  });
  it("shows an unknown server value as it came", () => {
    expect(fmt("shared", "enum", "visibility")).toBe("shared");
  });
});

describe("applyLabelKey and bodyArg", () => {
  it("picks the button label per tool", () => {
    expect(applyLabelKey("create_office_document")).toBe("ai.proposal.apply_create_open");
    expect(applyLabelKey("save_attachment_template")).toBe("ai.proposal.apply_save_template");
    expect(applyLabelKey("update_task")).toBe("ai.proposal.apply");
  });
  it("calls the Office body the outline", () => {
    expect(bodyArg("create_office_document")).toBe("outline");
  });
});

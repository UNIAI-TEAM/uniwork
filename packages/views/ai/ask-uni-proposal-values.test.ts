import { describe, expect, it } from "vitest";
import { initI18n } from "@uniwork/core/i18n";
import { AiProposalSchema } from "@uniwork/core/types";
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

const prop = (tool: string, editorAi?: string) =>
  AiProposalSchema.parse({
    tool,
    preview: { fields: editorAi === undefined ? [] : [{ field: "editor_ai", type: "enum", from: null, to: editorAi, options: [] }] },
  });

describe("applyLabelKey and bodyArg", () => {
  it("picks the Office button label from the editor AI's state", () => {
    expect(applyLabelKey(prop("create_office_document", "compose"))).toBe("ai.proposal.apply_open_compose");
    expect(applyLabelKey(prop("create_office_document", "build"))).toBe("ai.proposal.apply_open_build");
    for (const reason of ["plan", "off", "format_off", "credits", "other"]) {
      expect(applyLabelKey(prop("create_office_document", reason))).toBe("ai.proposal.apply_create_open_self");
    }
  });
  it("keeps the old label for a card with no editor_ai", () => {
    expect(applyLabelKey(prop("create_office_document"))).toBe("ai.proposal.apply_create_open");
  });
  it("leaves the other tools as they were", () => {
    expect(applyLabelKey(prop("save_attachment_template", "compose"))).toBe("ai.proposal.apply_save_template");
    expect(applyLabelKey(prop("update_task"))).toBe("ai.proposal.apply");
  });
  it("calls the Office body the outline", () => {
    expect(bodyArg("create_office_document")).toBe("outline");
  });
});

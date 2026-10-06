import { describe, expect, it } from "vitest";
import en from "../../../../packages/core/i18n/locales/en.json";
import vi from "../../../../packages/core/i18n/locales/vi.json";
import { answerRefusal, desktopFileFailureCodes } from "./failure-codes";

describe("desktop file failure codes", () => {
  it("are stable [a-z0-9_] identifiers", () => {
    for (const code of desktopFileFailureCodes()) expect(code).toMatch(/^[a-z0-9_]{1,64}$/);
  });
  it("each has en and vi copy under office.save.reason, so none falls back to office_unknown_error", () => {
    for (const code of [...desktopFileFailureCodes(), "file_failed"]) {
      expect(en.office.save.reason, code).toHaveProperty(code);
      expect(vi.office.save.reason, code).toHaveProperty(code);
    }
  });
  it("covers the open-side read, the save-side size and the checkpoint codes", () => {
    expect(desktopFileFailureCodes()).toEqual(expect.arrayContaining(["file_read_failed", "file_checkpoint_failed", "file_save_too_large"]));
  });
  it("answers an unmapped refusal with file_failed and rethrows anything else", async () => {
    const codeOf = (error: unknown) => (error as { code?: string }).code;
    const answer = (code: string) => ({ opened: false as const, code });
    await expect(answerRefusal(async () => { throw Object.assign(new Error("x"), { code: "brand_new" }); }, codeOf, answer)({})).resolves.toEqual({ opened: false, code: "file_failed" });
    await expect(answerRefusal(async () => { throw new Error("engine fault"); }, codeOf, answer)({})).rejects.toThrow("engine fault");
  });
});

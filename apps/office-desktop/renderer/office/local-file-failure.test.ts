import { expect, it } from "vitest";
import { throwIfLocalFileFailed } from "./local-file-failure";

it("throws an Error carrying the wire code, and ignores an answer without one", () => {
  expect(() => throwIfLocalFileFailed({ code: "file_locked" })).toThrow(expect.objectContaining({ code: "file_locked" }));
  expect(() => throwIfLocalFileFailed({})).not.toThrow();
});

it("reads a file_* code off a thrown refusal and nothing else", async () => {
  const { localFileFailureCode } = await import("./local-file-failure");
  expect(localFileFailureCode(Object.assign(new Error("file_locked"), { code: "file_locked" }))).toBe("file_locked");
  expect(localFileFailureCode(Object.assign(new Error("x"), { code: "save_as_cancelled" }))).toBeUndefined();
  expect(localFileFailureCode("file_locked")).toBeUndefined();
  expect(localFileFailureCode(new Error("file_locked"))).toBeUndefined();
});

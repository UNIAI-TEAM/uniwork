import { expect, it } from "vitest";
import { throwIfLocalFileFailed } from "./local-file-failure";

it("throws an Error carrying the wire code, and ignores an answer without one", () => {
  expect(() => throwIfLocalFileFailed({ code: "file_locked" })).toThrow(expect.objectContaining({ code: "file_locked" }));
  expect(() => throwIfLocalFileFailed({})).not.toThrow();
});

import { describe, expect, it } from "vitest";
import { ApiError } from "@uniwork/core/api";
import { createProjectErrorMessage } from "./create-project-error";

const copy = {
  duplicateTitle: "Đã có dự án với tên này.",
  fallback: "Không tạo được dự án",
};

describe("createProjectErrorMessage", () => {
  it("localizes duplicate project titles instead of exposing the server message", () => {
    expect(
      createProjectErrorMessage(
        new ApiError("project title already exists", "duplicate_project_title", 409),
        copy,
      ),
    ).toBe(copy.duplicateTitle);
  });

  it("keeps specific messages for unrelated API errors", () => {
    expect(createProjectErrorMessage(new ApiError("Server detail", "conflict", 409), copy)).toBe(
      "Server detail",
    );
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { useOfficeHandoffStore } from "./office-handoff-store";

const s = () => useOfficeHandoffStore.getState();

describe("office handoff store", () => {
  beforeEach(() => s().reset());

  it("take returns a queued entry once and marks it sent", () => {
    s().queue("d1", "h1", "job");
    expect(s().byDocument.d1?.status).toBe("pending");
    expect(s().take("d1")).toEqual({ handoffId: "h1", text: "job", status: "pending" });
    expect(s().byDocument.d1?.status).toBe("sent");
    expect(s().take("d1")).toBeNull();
    expect(s().take("other")).toBeNull();
  });

  it("setStatus updates an entry and never creates one", () => {
    s().setStatus("d1", "running");
    expect(s().byDocument).toEqual({});
    s().queue("d1", "h1", "job");
    s().setStatus("d1", "running");
    expect(s().byDocument.d1?.status).toBe("running");
  });

  it("reset empties the store", () => {
    s().queue("d1", "h1", "job");
    s().reset();
    expect(s().byDocument).toEqual({});
  });
});

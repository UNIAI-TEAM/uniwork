import { describe, expect, it } from "vitest";
import { titleParts } from "./notification-title";

describe("titleParts", () => {
  const render = (p: Record<string, string>) => `${p.actor} moved “${p.task}” to ${p.status}`;

  it("splits the rendered sentence into text and the params in the locale's order", () => {
    expect(titleParts(render, { actor: "An", task: "Spec", status: "done" })).toEqual([
      { param: "actor", value: "An" },
      { text: " moved “" },
      { param: "task", value: "Spec" },
      { text: "” to " },
      { param: "status", value: "done" },
    ]);
  });

  it("leaves a sentence without params whole", () => {
    expect(titleParts(() => "Your export is ready", {})).toEqual([{ text: "Your export is ready" }]);
  });
});

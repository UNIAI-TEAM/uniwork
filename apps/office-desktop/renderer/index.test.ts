import { expect, it } from "vitest";
import { mountDesktopRenderer } from "./index";

it("mounts through a supplied document adapter", () => {
  const root = { textContent: "", setAttribute: (_name: string, _value: string) => undefined };
  mountDesktopRenderer({ getElementById: (id) => id === "root" ? root : null });
  expect(root.textContent).toContain("UniWork Office desktop shell");
});

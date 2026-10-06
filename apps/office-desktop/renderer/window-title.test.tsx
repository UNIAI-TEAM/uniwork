// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWindowTitle } from "./window-title";

describe("useWindowTitle", () => {
  it("follows the active document and leaves the home tab's title empty for main to brand", () => {
    const { rerender } = renderHook(({ title }: { title?: string }) => useWindowTitle(title), { initialProps: { title: "Báo cáo quý.docx" } as { title?: string } });
    expect(document.title).toBe("Báo cáo quý.docx");
    rerender({ title: "Kế hoạch.xlsx" });
    expect(document.title).toBe("Kế hoạch.xlsx");
    rerender({ title: undefined });
    expect(document.title).toBe("");
    rerender({ title: "   " });
    expect(document.title).toBe("");
    // A document named like the product is still a document.
    rerender({ title: "UniWork Office" });
    expect(document.title).toBe("UniWork Office");
  });
});

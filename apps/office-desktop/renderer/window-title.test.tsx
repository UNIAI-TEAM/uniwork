// @vitest-environment jsdom
import { renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useWindowTitle } from "./window-title";

describe("useWindowTitle", () => {
  it("follows the active document and falls back to the product title", () => {
    const { rerender } = renderHook(({ title }: { title?: string }) => useWindowTitle(title), { initialProps: { title: "Báo cáo quý.docx" } });
    expect(document.title).toBe("Báo cáo quý.docx");
    rerender({ title: "Kế hoạch.xlsx" });
    expect(document.title).toBe("Kế hoạch.xlsx");
    rerender({ title: undefined });
    expect(document.title).toBe("UniWork Office");
    rerender({ title: "   " });
    expect(document.title).toBe("UniWork Office");
  });
});

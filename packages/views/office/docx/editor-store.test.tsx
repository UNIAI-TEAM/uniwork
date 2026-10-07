// UNI-957 (review r1 m3): no page-wide fallback scope. Chrome outside a
// DocxEditor fails loudly instead of sharing a module-level default.
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { createDocxDocumentScope, DocxDocumentScopeProvider, requireDocxScope, useDocxDocumentScope } from "./editor-store";

describe("DOCX document scope", () => {
  it("throws outside a provider instead of falling back to a shared scope", () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(() => renderHook(() => useDocxDocumentScope())).toThrow(/docx_document_scope_missing/);
    expect(() => requireDocxScope(null)).toThrow(/docx_document_scope_missing/);
    vi.restoreAllMocks();
  });

  it("gives each provider its own scope", () => {
    const a = createDocxDocumentScope();
    const b = createDocxDocumentScope();
    function WrapA({ children }: { children: ReactNode }) {
      return <DocxDocumentScopeProvider scope={a}>{children}</DocxDocumentScopeProvider>;
    }
    function WrapB({ children }: { children: ReactNode }) {
      return <DocxDocumentScopeProvider scope={b}>{children}</DocxDocumentScopeProvider>;
    }
    expect(renderHook(() => useDocxDocumentScope(), { wrapper: WrapA }).result.current).toBe(a);
    expect(renderHook(() => useDocxDocumentScope(), { wrapper: WrapB }).result.current).toBe(b);
    expect(a.zoom).not.toBe(b.zoom);
  });
});

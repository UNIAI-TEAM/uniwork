import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultStorage } from "../platform/storage";
import { useOfficeRibbonCollapsed, useOfficeRibbonPreferencesStore } from "./ribbon-preferences";

beforeEach(() => {
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
  defaultStorage.removeItem("uniwork_office_ribbon");
});

describe("office ribbon preferences", () => {
  it("defaults to expanded and keeps each scope apart", () => {
    const docx = renderHook(() => useOfficeRibbonCollapsed("docx"));
    const xlsx = renderHook(() => useOfficeRibbonCollapsed("xlsx"));
    expect(docx.result.current[0]).toBe(false);
    act(() => docx.result.current[1](true));
    expect(docx.result.current[0]).toBe(true);
    expect(xlsx.result.current[0]).toBe(false);
  });

  it("persists through the storage adapter", () => {
    useOfficeRibbonPreferencesStore.getState().setCollapsed("pptx", true);
    const raw = defaultStorage.getItem("uniwork_office_ribbon");
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw ?? "{}").state).toEqual({ collapsed: { pptx: true } });
  });
});

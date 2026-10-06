// UNI-957: shared Office chrome mounted for a document kept in a hidden desktop
// tab must not react to keys meant for the visible document.
import { fireEvent, render, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { useOfficeRibbonPreferencesStore } from "@uniwork/core/office/ribbon-preferences";
import { OfficeRibbon } from "../ribbon/office-ribbon";
import { ribbonFixture } from "../ribbon/test/fixtures";
import { OfficeDocumentActiveProvider, useOfficeDocumentActive, useOfficeDocumentActiveRef } from "./document-active";
import { FindReplacePanel } from "./find";

initI18n();

beforeEach(async () => {
  await setLocale("en");
  useOfficeRibbonPreferencesStore.setState({ collapsed: {} });
});

describe("OfficeDocumentActiveProvider", () => {
  it("reads active without a provider (one document per web page)", () => {
    expect(renderHook(() => useOfficeDocumentActive()).result.current).toBe(true);
  });

  it("carries the flag to hooks and keeps the ref current", () => {
    let active = false;
    const wrapper = ({ children }: { children: ReactNode }) => <OfficeDocumentActiveProvider active={active}>{children}</OfficeDocumentActiveProvider>;
    const hook = renderHook(() => useOfficeDocumentActiveRef(), { wrapper });
    expect(hook.result.current.current).toBe(false);
    active = true;
    hook.rerender();
    expect(hook.result.current.current).toBe(true);
  });
});

describe("shared chrome in two mounted documents", () => {
  it("toggles only the visible document's ribbon on Ctrl+F1", () => {
    render(
      <>
        <OfficeDocumentActiveProvider active={false}><OfficeRibbon tabs={ribbonFixture().tabs} scope="xlsx" /></OfficeDocumentActiveProvider>
        <OfficeDocumentActiveProvider active><OfficeRibbon tabs={ribbonFixture().tabs} scope="docx" /></OfficeDocumentActiveProvider>
      </>,
    );
    fireEvent.keyDown(window, { key: "F1", ctrlKey: true });
    const collapsed = useOfficeRibbonPreferencesStore.getState().collapsed;
    expect(collapsed.docx).toBe(true);
    expect(collapsed.xlsx).not.toBe(true);
  });

  it("closes only the visible document's find panel on Escape", () => {
    const closeHidden = vi.fn();
    const closeVisible = vi.fn();
    render(
      <>
        <OfficeDocumentActiveProvider active={false}><FindReplacePanel text="a a" onClose={closeHidden} /></OfficeDocumentActiveProvider>
        <OfficeDocumentActiveProvider active><FindReplacePanel text="b b" onClose={closeVisible} /></OfficeDocumentActiveProvider>
      </>,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(closeVisible).toHaveBeenCalledTimes(1);
    expect(closeHidden).not.toHaveBeenCalled();
  });
});

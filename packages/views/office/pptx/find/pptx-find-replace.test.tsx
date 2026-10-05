// A6ui (UNI-927) - jsdom tests for the find & replace panel.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxFindReplacePanel } from "./pptx-find-replace";
import { findI18nResources } from "./find-i18n";
import type { PptxFindTextTarget } from "./pptx-find-model";

const i18n = initI18n();
i18n.addResourceBundle("en", "translation", findI18nResources("en"), true, true);
i18n.addResourceBundle("vi", "translation", findI18nResources("vi"), true, true);
beforeEach(async () => { await setLocale("en"); });

const TEXTS: PptxFindTextTarget[] = [
  { text: "Alpha slide", slideIndex: 0, elementId: "t1" },
  { text: "another slide", slideIndex: 1, elementId: "t3" },
];

function renderPanel(overrides: Partial<Parameters<typeof PptxFindReplacePanel>[0]> = {}) {
  const onFindReplace = vi.fn(async () => undefined);
  const view = render(
    <PptxFindReplacePanel texts={TEXTS} onFindReplace={onFindReplace} {...overrides} />,
  );
  return { view, onFindReplace };
}

describe("PptxFindReplacePanel", () => {
  it("mounts the query, replace and action controls", () => {
    renderPanel();
    expect(screen.getByRole("region", { name: "Find and replace" })).toHaveAttribute("data-pptx-find-replace");
    expect(screen.getByRole("textbox", { name: "Find" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Replace with" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Match case" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Replace all" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find next" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Find previous" })).toBeInTheDocument();
  });

  it("reports the match count for the typed query", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "slide" } });
    expect(document.querySelector("[data-pptx-find-count]")).toHaveTextContent("Match 1 of 2");
  });

  it("shows the no-match state for a query with no hits", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "zzz" } });
    expect(document.querySelector("[data-pptx-find-count]")).toHaveTextContent("No matches");
    expect(screen.getByRole("button", { name: "Replace" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Replace all" })).toBeDisabled();
  });

  it("navigates hits with the next/previous buttons and wraps", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "slide" } });
    expect(document.querySelector("[data-pptx-find-count]")).toHaveTextContent("Match 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Find next" }));
    expect(document.querySelector("[data-pptx-find-count]")).toHaveTextContent("Match 2 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Find next" }));
    expect(document.querySelector("[data-pptx-find-count]")).toHaveTextContent("Match 1 of 2");
    fireEvent.click(screen.getByRole("button", { name: "Find previous" }));
    expect(document.querySelector("[data-pptx-find-count]")).toHaveTextContent("Match 2 of 2");
  });

  it("emits a replace-all edit for the whole deck", async () => {
    const { onFindReplace } = renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "slide" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Replace with" }), { target: { value: "deck" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(onFindReplace).toHaveBeenCalledTimes(1));
    expect(onFindReplace).toHaveBeenCalledWith({ op: "find_replace", find: "slide", replace: "deck", matchCase: false });
  });

  it("emits a scoped replace-one edit for the active hit", async () => {
    const { onFindReplace } = renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "slide" } });
    fireEvent.click(screen.getByRole("button", { name: "Find next" }));
    fireEvent.click(screen.getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(onFindReplace).toHaveBeenCalledTimes(1));
    expect(onFindReplace).toHaveBeenCalledWith({
      op: "find_replace",
      find: "slide",
      replace: "",
      matchCase: false,
      firstOnly: true,
      slideIndex: 1,
      elementId: "t3",
    });
  });

  it("honours the match-case toggle", () => {
    renderPanel();
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "ALPHA" } });
    expect(document.querySelector("[data-pptx-find-count]")).toHaveTextContent("Match 1 of 1");
    fireEvent.click(screen.getByRole("checkbox", { name: "Match case" }));
    expect(document.querySelector("[data-pptx-find-count]")).toHaveTextContent("No matches");
  });

  it("stays honest with no port bound", () => {
    renderPanel({ onFindReplace: undefined });
    expect(screen.getByTestId("pptx-find-unbound")).toHaveTextContent("Find and replace are not connected to this editor yet.");
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "slide" } });
    expect(screen.getByRole("button", { name: "Replace all" })).toBeDisabled();
  });

  it("disables the actions in a read-only deck", () => {
    renderPanel({ readonly: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "slide" } });
    expect(screen.getByRole("button", { name: "Replace all" })).toBeDisabled();
    expect(screen.getByTestId("pptx-find-unbound")).toHaveTextContent("This presentation is read-only.");
  });

  it("surfaces a refused replace without losing the fields", async () => {
    const onFindReplace = vi.fn(async () => { throw new Error("bad_find: nope"); });
    renderPanel({ onFindReplace });
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "slide" } });
    fireEvent.click(screen.getByRole("button", { name: "Replace all" }));
    await waitFor(() => expect(screen.getByTestId("pptx-find-error")).toBeInTheDocument());
    expect(screen.getByRole("textbox", { name: "Find" })).toHaveValue("slide");
  });

  it("reports the active hit's slide and element, and null when nothing matches (R2-6)", () => {
    const onActiveHitChange = vi.fn();
    renderPanel({ onActiveHitChange });
    expect(onActiveHitChange).toHaveBeenLastCalledWith(null);
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "slide" } });
    expect(onActiveHitChange).toHaveBeenLastCalledWith({ slideIndex: 0, elementId: "t1" });
    fireEvent.click(screen.getByRole("button", { name: "Find next" }));
    expect(onActiveHitChange).toHaveBeenLastCalledWith({ slideIndex: 1, elementId: "t3" });
    fireEvent.change(screen.getByRole("textbox", { name: "Find" }), { target: { value: "zzz" } });
    expect(onActiveHitChange).toHaveBeenLastCalledWith(null);
  });
});

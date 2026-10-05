// A6ui (UNI-927) - jsdom tests for the hyperlink editor.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { PptxLinkEditor } from "./pptx-link-editor";
import { linkI18nResources } from "./links-i18n";

const i18n = initI18n();
i18n.addResourceBundle("en", "translation", linkI18nResources("en"), true, true);
i18n.addResourceBundle("vi", "translation", linkI18nResources("vi"), true, true);
beforeEach(async () => { await setLocale("en"); });

function renderEditor(overrides: Partial<Parameters<typeof PptxLinkEditor>[0]> = {}) {
  const onSetLink = vi.fn(async () => undefined);
  const view = render(
    <PptxLinkEditor slideIndex={1} elementId="t3" slideCount={4} onSetLink={onSetLink} {...overrides} />,
  );
  return { view, onSetLink };
}

describe("PptxLinkEditor", () => {
  it("mounts the three link modes and the actions", () => {
    renderEditor();
    expect(screen.getByRole("region", { name: "Hyperlink" })).toHaveAttribute("data-pptx-link-editor");
    expect(screen.getByRole("radio", { name: "Web address" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Place in this document" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Show action" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Apply" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove link" })).toBeInTheDocument();
    expect(screen.getByText("No link")).toBeInTheDocument();
  });

  it("sets a url link on the selected element", async () => {
    const { onSetLink } = renderEditor();
    fireEvent.change(screen.getByTestId("pptx-link-url"), { target: { value: "https://a.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onSetLink).toHaveBeenCalledTimes(1));
    expect(onSetLink).toHaveBeenCalledWith({
      op: "set_link",
      slideIndex: 1,
      elementId: "t3",
      link: { kind: "url", url: "https://a.test" },
    });
  });

  it("refuses an empty address instead of sending it", () => {
    const { onSetLink } = renderEditor();
    expect(screen.getByTestId("pptx-link-url")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByTestId("pptx-link-invalid")).toHaveTextContent("Enter a web address such as https://example.com.");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    expect(onSetLink).not.toHaveBeenCalled();
  });

  it("sets a slide-jump link from the slide field", async () => {
    const { onSetLink } = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Place in this document" }));
    fireEvent.change(screen.getByTestId("pptx-link-slide"), { target: { value: "3" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onSetLink).toHaveBeenCalledTimes(1));
    expect(onSetLink).toHaveBeenCalledWith({
      op: "set_link",
      slideIndex: 1,
      elementId: "t3",
      link: { kind: "slide", slideIndex: 2 },
    });
  });

  it("sets a named show action", async () => {
    const { onSetLink } = renderEditor();
    fireEvent.click(screen.getByRole("radio", { name: "Show action" }));
    fireEvent.click(screen.getByRole("radio", { name: "End show" }));
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(onSetLink).toHaveBeenCalledTimes(1));
    expect(onSetLink).toHaveBeenCalledWith({
      op: "set_link",
      slideIndex: 1,
      elementId: "t3",
      link: { kind: "action", action: "endshow" },
    });
  });

  it("removes an existing link with a null target", async () => {
    const { onSetLink } = renderEditor({ link: { kind: "url", url: "https://a.test" } });
    expect(screen.getByText("Link: https://a.test")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Remove link" }));
    await waitFor(() => expect(onSetLink).toHaveBeenCalledTimes(1));
    expect(onSetLink).toHaveBeenCalledWith({ op: "set_link", slideIndex: 1, elementId: "t3", link: null });
  });

  it("seeds the fields from the element's current link", () => {
    renderEditor({ link: { kind: "action", action: "lastslide" } });
    expect(screen.getByRole("radio", { name: "Show action" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "Last slide" })).toHaveAttribute("aria-checked", "true");
  });

  it("stays honest with no port bound or no selection", () => {
    renderEditor({ onSetLink: undefined });
    expect(screen.getByTestId("pptx-link-unbound")).toHaveTextContent("Hyperlinks are not connected to this editor yet.");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("asks for a selection when no element is chosen", () => {
    renderEditor({ elementId: null });
    expect(screen.getByTestId("pptx-link-unbound")).toHaveTextContent("Select an element to link.");
    expect(screen.getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("surfaces a refused link without losing the draft", async () => {
    const onSetLink = vi.fn(async () => { throw new Error("bad_link: nope"); });
    renderEditor({ onSetLink });
    fireEvent.change(screen.getByTestId("pptx-link-url"), { target: { value: "https://a.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(screen.getByTestId("pptx-link-error")).toBeInTheDocument());
    expect(screen.getByTestId("pptx-link-url")).toHaveValue("https://a.test");
  });
});

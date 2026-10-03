import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { PdfPage } from "../types";
import { PdfPages } from "./pdf-pages";

initI18n();
beforeEach(async () => { await setLocale("en"); });

const pages: readonly PdfPage[] = [
  { pageNumber: 1, rotation: 0 },
  { pageNumber: 2, rotation: 90 },
  { pageNumber: 3, rotation: 0 },
];

describe("PdfPages", () => {
  it("selects one page and supports additive multi-select", () => {
    const onSelectionChange = vi.fn();
    render(<PdfPages pages={pages} onSelectionChange={onSelectionChange} />);

    const pageTwo = screen.getByRole("button", { name: "Page 2" });
    fireEvent.click(pageTwo);
    expect(onSelectionChange).toHaveBeenLastCalledWith([2]);
    fireEvent.click(screen.getByRole("button", { name: "Page 3" }), { ctrlKey: true });
    expect(onSelectionChange).toHaveBeenLastCalledWith([2, 3]);
    expect(screen.getByRole("button", { name: "Page 2" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Page 3" })).toHaveAttribute("aria-pressed", "true");
  });

  it("rotates and deletes every selected page through typed contracts", () => {
    const rotatePages = vi.fn();
    const deletePage = vi.fn();
    render(<PdfPages pages={pages} onSelectionChange={() => undefined} rotatePages={rotatePages} deletePage={deletePage} selectedPages={[1, 3]} />);

    fireEvent.click(screen.getByRole("button", { name: "Rotate page" }));
    expect(rotatePages).toHaveBeenCalledWith([1, 3], 90);
    fireEvent.click(screen.getByRole("button", { name: "Delete page" }));
    expect(deletePage.mock.calls).toEqual([[3], [1]]);
  });

  it("emits the new page order when a thumbnail is dropped", () => {
    const setPageOrder = vi.fn();
    render(<PdfPages pages={pages} setPageOrder={setPageOrder} />);
    const source = screen.getByTestId("pdf-page-1");
    const target = screen.getByTestId("pdf-page-3");
    fireEvent.dragStart(source);
    fireEvent.dragOver(target);
    fireEvent.drop(target);
    expect(setPageOrder).toHaveBeenCalledWith([2, 3, 1]);
  });
});

it("supports zero-based browser-safe provider envelopes", () => {
  const provider = { rotatePages: vi.fn(), deletePage: vi.fn(), setPageOrder: vi.fn() };
  render(<PdfPages pages={pages} provider={provider} selectedPages={[2]} />);
  fireEvent.click(screen.getByRole("button", { name: "Rotate page" }));
  expect(provider.rotatePages).toHaveBeenCalledWith({ pages: [1], dir: 90 });
  fireEvent.click(screen.getByRole("button", { name: "Delete page" }));
  expect(provider.deletePage).toHaveBeenCalledWith({ pageIndex: 1 });
});

it("maps a drag to the provider's zero-based page order", () => {
  const provider = { rotatePages: vi.fn(), deletePage: vi.fn(), setPageOrder: vi.fn() };
  render(<PdfPages pages={pages} provider={provider} />);
  fireEvent.dragStart(screen.getByTestId("pdf-page-1"));
  fireEvent.dragOver(screen.getByTestId("pdf-page-3"));
  fireEvent.drop(screen.getByTestId("pdf-page-3"));
  expect(provider.setPageOrder).toHaveBeenCalledWith({ order: [1, 2, 0] });
});

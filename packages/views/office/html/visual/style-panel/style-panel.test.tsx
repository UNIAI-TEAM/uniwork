// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
// Imported through the barrel: the panel is not mounted yet (the shell mount
// is the lead's), so this test is what keeps the package's public surface
// (index.ts) reachable and knip from reading it as dead code - the same
// pattern ops/helpers.test.ts uses.
import {
  HtmlStylePanel,
  defaultHtmlStyleValues,
  type HtmlStylePanelProps,
  type HtmlStylePatch,
  type HtmlStyleValues,
} from "./index";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

function values(overrides: Partial<HtmlStyleValues> = {}): HtmlStyleValues {
  return { ...defaultHtmlStyleValues(), ...overrides };
}

function handlers() {
  return { onChange: vi.fn<(patch: HtmlStylePatch) => void>(), onRevert: vi.fn() };
}

/** The tests select by the panel's stable hooks (`data-testid`, `data-align`,
 * `data-fit`, `data-bg-swatch`), never by a translated label: the locale keys
 * are written by another owner, so a label-based selector would break the day
 * they land. */
function hook<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.querySelector<T>(`[data-testid="${id}"]`);
  if (!found) throw new Error(`style hook ${id} not found`);
  return found;
}

/** The registry Select does not forward `data-testid` to its trigger, so the
 * two selects are selected by the id the panel gives their trigger. */
function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (!found) throw new Error(`style control ${id} not found`);
  return found as T;
}

/** The public prop shape, pinned at the type level: the barrel's surface is
 * what a mounting host (and H6's entry) builds against, so a change here is a
 * contract change, not an implementation detail. */
const PANEL_PROPS: HtmlStylePanelProps = {
  values: defaultHtmlStyleValues(),
  isImage: false,
  disabled: false,
  onChange: () => {},
  onRevert: () => {},
};

describe("HtmlStylePanel rendering", () => {
  it("pins the public prop shape", () => {
    expect(PANEL_PROPS.isImage).toBe(false);
    expect(PANEL_PROPS.values.size.width).toBeNull();
  });

  it("renders the typography, size, appearance and custom-CSS controls", () => {
    render(<HtmlStylePanel values={values()} {...handlers()} />);
    expect(screen.getByTestId("html-style-panel")).toBeInTheDocument();
    // Selected by the trigger's own id, not by an accessible name: the label
    // text comes from a locale key another owner writes (see the MISSING KEY
    // list), so a name-based selector would fail until it lands.
    expect(byId("html-style-font")).toBeInTheDocument();
    expect(byId("html-style-weight")).toBeInTheDocument();
    expect(hook("html-style-align")).toBeInTheDocument();
    expect(hook("html-style-width")).toBeInTheDocument();
    expect(hook("html-style-height")).toBeInTheDocument();
    expect(hook("html-style-aspect-lock")).toBeInTheDocument();
    expect(hook("html-style-opacity")).toBeInTheDocument();
    expect(hook("html-style-custom-css")).toBeInTheDocument();
    expect(hook("html-style-revert")).toBeInTheDocument();
  });

  it("shows the image-only controls only for an image selection", () => {
    const { rerender } = render(<HtmlStylePanel values={values()} {...handlers()} />);
    expect(screen.queryByTestId("html-style-alt")).toBeNull();
    expect(screen.queryByTestId("html-style-fit")).toBeNull();
    expect(screen.getByTestId("html-style-panel")).toHaveAttribute("data-style-image", "false");

    rerender(<HtmlStylePanel values={values()} isImage {...handlers()} />);
    expect(screen.getByTestId("html-style-alt")).toBeInTheDocument();
    expect(screen.getByTestId("html-style-fit")).toBeInTheDocument();
    expect(screen.getByTestId("html-style-panel")).toHaveAttribute("data-style-image", "true");
  });

  it("shows the current values, including the aspect-lock state", () => {
    render(
      <HtmlStylePanel
        values={values({ size: { width: 320, height: 180, aspectLocked: true, aspectRatio: 16 / 9 }, opacity: 40 })}
        {...handlers()}
      />,
    );
    expect(hook<HTMLInputElement>("html-style-width").value).toBe("320");
    expect(hook<HTMLInputElement>("html-style-height").value).toBe("180");
    expect(hook("html-style-aspect-lock")).toHaveAttribute("aria-pressed", "true");
    expect(hook("html-style-opacity-value")).toHaveAttribute("data-opacity-percent", "40");
  });
});

describe("HtmlStylePanel callbacks", () => {
  it("reports a typography patch when the alignment changes", () => {
    const { onChange } = handlers();
    render(<HtmlStylePanel values={values()} onChange={onChange} onRevert={vi.fn()} />);
    fireEvent.click(document.querySelector<HTMLElement>('[data-align="center"]')!);
    expect(onChange).toHaveBeenCalledWith({ typography: { textAlign: "center" } });
  });

  it("reports a size patch carrying both dimensions when the width changes", () => {
    const { onChange } = handlers();
    render(<HtmlStylePanel values={values({ size: { width: 100, height: 50, aspectLocked: false, aspectRatio: 2 } })} onChange={onChange} onRevert={vi.fn()} />);
    fireEvent.change(hook<HTMLInputElement>("html-style-width"), { target: { value: "250" } });
    expect(onChange).toHaveBeenCalledWith({ size: { width: 250, height: 50 } });
  });

  it("toggles the aspect lock through the model's own patch", () => {
    const { onChange } = handlers();
    render(<HtmlStylePanel values={values()} onChange={onChange} onRevert={vi.fn()} />);
    fireEvent.click(hook("html-style-aspect-lock"));
    expect(onChange).toHaveBeenCalledWith({ size: { aspectLocked: true } });
  });

  it("reports the background colour and its clear row", () => {
    const { onChange } = handlers();
    render(<HtmlStylePanel values={values()} onChange={onChange} onRevert={vi.fn()} />);
    fireEvent.click(document.querySelector<HTMLElement>('[data-bg-swatch="#16a34a"]')!);
    expect(onChange).toHaveBeenCalledWith({ background: "#16a34a" });
    fireEvent.click(hook("html-style-background-none"));
    expect(onChange).toHaveBeenLastCalledWith({ background: null });
  });

  it("reports opacity from the slider", () => {
    const { onChange } = handlers();
    render(<HtmlStylePanel values={values()} onChange={onChange} onRevert={vi.fn()} />);
    const input = hook("html-style-opacity").querySelector<HTMLInputElement>('input[type="range"]')!;
    fireEvent.change(input, { target: { value: "35" } });
    expect(onChange).toHaveBeenCalledWith({ opacity: 35 });
  });

  it("reports alt and fit only for an image", () => {
    const { onChange } = handlers();
    render(<HtmlStylePanel values={values()} isImage onChange={onChange} onRevert={vi.fn()} />);
    fireEvent.change(hook<HTMLInputElement>("html-style-alt"), { target: { value: "Ảnh minh hoạ" } });
    expect(onChange).toHaveBeenCalledWith({ alt: "Ảnh minh hoạ" });
    fireEvent.click(document.querySelector<HTMLElement>('[data-fit="cover"]')!);
    expect(onChange).toHaveBeenCalledWith({ fit: "cover" });
  });

  it("passes the custom CSS through as a plain string, never as markup", () => {
    const { onChange } = handlers();
    render(<HtmlStylePanel values={values()} onChange={onChange} onRevert={vi.fn()} />);
    fireEvent.change(hook<HTMLTextAreaElement>("html-style-custom-css"), { target: { value: "color: red; <script>alert(1)</script>" } });
    expect(onChange).toHaveBeenCalledWith({ customCss: "color: red; <script>alert(1)</script>" });
  });

  it("fires revert", () => {
    const { onRevert } = handlers();
    render(<HtmlStylePanel values={values()} onChange={vi.fn()} onRevert={onRevert} />);
    fireEvent.click(hook("html-style-revert"));
    expect(onRevert).toHaveBeenCalledOnce();
  });
});

describe("HtmlStylePanel aspect lock keeps the ratio", () => {
  it("derives the height from the width when the lock is on", () => {
    const { onChange } = handlers();
    render(
      <HtmlStylePanel
        values={values({ size: { width: 200, height: 100, aspectLocked: true, aspectRatio: 2 } })}
        onChange={onChange}
        onRevert={vi.fn()}
      />,
    );
    fireEvent.change(hook<HTMLInputElement>("html-style-width"), { target: { value: "500" } });
    expect(onChange).toHaveBeenCalledWith({ size: { width: 500, height: 250 } });
  });

  it("derives the width from the height when the lock is on", () => {
    const { onChange } = handlers();
    render(
      <HtmlStylePanel
        values={values({ size: { width: 200, height: 100, aspectLocked: true, aspectRatio: 2 } })}
        onChange={onChange}
        onRevert={vi.fn()}
      />,
    );
    fireEvent.change(hook<HTMLInputElement>("html-style-height"), { target: { value: "300" } });
    expect(onChange).toHaveBeenCalledWith({ size: { width: 600, height: 300 } });
  });
});

describe("HtmlStylePanel disabled", () => {
  it("renders every control inert", () => {
    const { onChange, onRevert } = handlers();
    render(<HtmlStylePanel values={values()} isImage disabled onChange={onChange} onRevert={onRevert} />);
    expect(hook("html-style-width")).toBeDisabled();
    expect(hook("html-style-aspect-lock")).toBeDisabled();
    expect(hook("html-style-custom-css")).toBeDisabled();
    expect(hook("html-style-revert")).toBeDisabled();
    expect(hook("html-style-alt")).toBeDisabled();
    fireEvent.click(hook("html-style-revert"));
    expect(onRevert).not.toHaveBeenCalled();
  });
});

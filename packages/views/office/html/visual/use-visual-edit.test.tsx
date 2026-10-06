// @vitest-environment jsdom
/**
 * The visual-edit wiring against the REAL html engine (fixture parse map): the
 * flag/host/read-only/present gates, the sid-stamped preview copy, and that a
 * toolbar action or panel change lands as an op in the engine's source.
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { openFixture, type OpenFixture } from "./ops/test-fixture";
import { elementByPath, setText } from "./ops";
import { useHtmlVisualEdit, type HtmlVisualEditHost, type UseHtmlVisualEditOptions } from "./use-visual-edit";

const flagMock = vi.hoisted(() => ({ value: true }));
vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_edit" ? flagMock.value : fallback),
}));

initI18n();
beforeEach(async () => {
  flagMock.value = true;
  await setLocale("en");
});

const SOURCE = `<main><p style="color:red">One</p><img src="a.png" alt="A"></main>`;
const P = "main:nth-of-type(1) > p:nth-of-type(1)";
const IMG = "main:nth-of-type(1) > img:nth-of-type(1)";

function hostFor(f: OpenFixture): HtmlVisualEditHost {
  return {
    parseMap: () => f.engine.parseMap(f.ref),
    revision: () => f.engine.snapshot(f.ref).revision,
    applyPatchSet: (set) => void f.engine.applyPatchSet(f.ref, set),
  };
}

function setup(f: OpenFixture, extra: Partial<UseHtmlVisualEditOptions> = {}) {
  const onApplied = vi.fn();
  const host = hostFor(f);
  const options: UseHtmlVisualEditOptions = {
    host,
    text: f.text,
    readOnly: false,
    presenting: false,
    readText: () => f.engine.snapshot(f.ref).text,
    onApplied,
    ...extra,
  };
  const hook = renderHook((props: UseHtmlVisualEditOptions) => useHtmlVisualEdit(props), { initialProps: options });
  return { hook, onApplied, host, options };
}

const select = (hook: ReturnType<typeof setup>["hook"], sid: number) =>
  act(() => hook.result.current.onPreviewSelection?.({ sid, rect: null, nodeName: null }));

describe("gates", () => {
  it("flag off: inert props, the unstamped text, no actions", async () => {
    flagMock.value = false;
    const f = await openFixture(SOURCE);
    const { hook } = setup(f);
    const props = hook.result.current;
    expect(props.visualEdit).toBe(false);
    expect(props.previewText).toBe(f.text);
    expect(props.inlineEdit).toBeUndefined();
    expect(props.floatCommands).toBeUndefined();
    expect(props.overlay).toBeUndefined();
    expect(props.onPreviewSelection).toBeUndefined();
  });

  it("no host (the desktop today) is inert even with the flag on", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f, { host: undefined });
    expect(hook.result.current.visualEdit).toBe(false);
    expect(hook.result.current.previewText).toBe(f.text);
  });

  it("read-only is inert", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f, { readOnly: true });
    expect(hook.result.current.visualEdit).toBe(false);
  });

  it("flag on + host: stamped preview copy, inspector requested, not while presenting", async () => {
    const f = await openFixture(SOURCE);
    const { hook, options } = setup(f);
    expect(hook.result.current.visualEdit).toBe(true);
    expect(hook.result.current.previewText).toMatch(/<p data-sid="\d+"/);
    expect(hook.result.current.previewText.replace(/ data-sid="\d+"/g, "")).toBe(f.text);
    hook.rerender({ ...options, presenting: true });
    expect(hook.result.current.visualEdit).toBe(false);
  });

  it("a host with no parse map leaves the preview unstamped, not broken", async () => {
    const f = await openFixture(SOURCE);
    const host = { ...hostFor(f), parseMap: () => { throw new Error("no parse map"); } };
    const { hook } = setup(f, { host });
    expect(hook.result.current.previewText).toBe(f.text);
  });
});

describe("edits land as ops in the engine", () => {
  it("duplicate / delete / mark / size / colour through the float commands", async () => {
    const f = await openFixture(SOURCE);
    const { hook, onApplied } = setup(f);
    const sid = elementByPath(f.map, P)!.sid;
    select(hook, sid);
    const read = () => f.engine.snapshot(f.ref).text;

    act(() => hook.result.current.floatCommands!.onBold!());
    expect(read()).toContain("color:red;font-weight:700");
    act(() => hook.result.current.floatCommands!.onFontSizeIncrease!());
    expect(read()).toContain("font-size:18px");
    act(() => hook.result.current.floatCommands!.onColour!("blue"));
    expect(read()).toContain("color:#2563eb");
    expect(onApplied).toHaveBeenCalledTimes(3);

    act(() => hook.result.current.floatCommands!.onDuplicate!());
    expect(read().match(/<p /g)).toHaveLength(2);
    act(() => hook.result.current.floatCommands!.onDelete!());
    expect(read().match(/<p /g)).toHaveLength(1);
  });

  it("html, head and body cannot be deleted or duplicated, their style edits stay", async () => {
    const f = await openFixture("<html><head><title>T</title></head><body><p>x</p></body></html>");
    const { hook } = setup(f);
    for (const path of ["html", "html > head", "html > body"]) {
      select(hook, elementByPath(f.map, path)!.sid);
      expect(hook.result.current.floatCommands!.onDelete, path).toBeUndefined();
      expect(hook.result.current.floatCommands!.onDuplicate, path).toBeUndefined();
      expect(hook.result.current.floatCommands!.onBold, path).toBeDefined();
    }
    select(hook, elementByPath(f.map, "html > body > p:nth-of-type(1)")!.sid);
    expect(hook.result.current.floatCommands!.onDelete).toBeDefined();
    expect(hook.result.current.floatCommands!.onDuplicate).toBeDefined();
  });

  it("an edit whose element is gone changes nothing and does not throw", async () => {
    const f = await openFixture(SOURCE);
    const { hook, onApplied } = setup(f);
    select(hook, 99999);
    act(() => hook.result.current.floatCommands!.onDelete!());
    expect(onApplied).not.toHaveBeenCalled();
    expect(f.engine.snapshot(f.ref).text).toBe(SOURCE);
  });

  it("the inline-edit port refuses a stale patch set instead of throwing", async () => {
    const f = await openFixture(SOURCE);
    const { hook, onApplied } = setup(f);
    const stale = setText({ text: f.text, map: f.map, version: f.version }, { sid: elementByPath(f.map, P)!.sid }, "X");
    expect(hook.result.current.inlineEdit!.apply(stale)).toBe(true);
    // Same base revision again: the engine has moved on, so it is stale.
    expect(hook.result.current.inlineEdit!.apply(stale)).toBe(false);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it("the inline-edit port exposes the live inspector of the preview session", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f);
    expect(hook.result.current.inlineEdit!.inspector).toBeNull();
    const inspector = { command: vi.fn(() => true) };
    act(() => hook.result.current.onPreviewSession?.({ dispose: vi.fn(), inspector } as never));
    expect(hook.result.current.inlineEdit!.inspector).toBe(inspector);
    act(() => hook.result.current.onPreviewSession?.(null));
    expect(hook.result.current.inlineEdit!.inspector).toBeNull();
  });
});

describe("a refused edit says so", () => {
  const notice = () => screen.queryByRole("status");

  it("shows a visible notice, then clears it on the next edit that lands", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f);
    expect(hook.result.current.overlay).toBeNull();
    select(hook, 99999);
    act(() => hook.result.current.floatCommands!.onDelete!());
    const shown = render(<>{hook.result.current.overlay}</>);
    expect(notice()).toHaveTextContent("That change can't be applied to this element.");
    shown.unmount();

    select(hook, elementByPath(f.map, P)!.sid);
    act(() => hook.result.current.floatCommands!.onBold!());
    expect(hook.result.current.overlay).toBeNull();
  });

  it("a stale patch set through the inline-edit port is also announced", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f);
    const stale = setText({ text: f.text, map: f.map, version: f.version }, { sid: elementByPath(f.map, P)!.sid }, "X");
    act(() => void hook.result.current.inlineEdit!.apply(stale));
    act(() => void hook.result.current.inlineEdit!.apply(stale));
    render(<>{hook.result.current.overlay}</>);
    expect(notice()).toHaveTextContent("That change can't be applied to this element.");
  });

  it("an op the document cannot express in the inline-edit bridge is announced through the port", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f);
    act(() => hook.result.current.inlineEdit!.refused!());
    render(<>{hook.result.current.overlay}</>);
    expect(notice()).toBeInTheDocument();
  });

  it("clears when the selection changes", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f);
    select(hook, 99999);
    act(() => hook.result.current.floatCommands!.onDelete!());
    expect(hook.result.current.overlay).not.toBeNull();
    select(hook, elementByPath(f.map, P)!.sid);
    expect(hook.result.current.overlay).toBeNull();
  });
});

describe("style panel", () => {
  it("opens from the toolbar, shows the element's own style and edits it", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f);
    select(hook, elementByPath(f.map, IMG)!.sid);
    expect(hook.result.current.overlay).toBeNull();
    act(() => hook.result.current.floatCommands!.onOpenStylePanel!());
    render(<>{hook.result.current.overlay}</>);
    const panel = screen.getByTestId("html-style-panel");
    expect(panel).toHaveAttribute("data-style-image", "true");
    expect(screen.getByLabelText("Alt text")).toHaveValue("A");
  });

  it("closes when the selection clears", async () => {
    const f = await openFixture(SOURCE);
    const { hook } = setup(f);
    select(hook, elementByPath(f.map, P)!.sid);
    act(() => hook.result.current.floatCommands!.onOpenStylePanel!());
    expect(hook.result.current.overlay).not.toBeNull();
    act(() => hook.result.current.onPreviewSelection?.(null));
    expect(hook.result.current.overlay).toBeNull();
  });
});

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPreviewEventSink } from "../selection/model";
import type { UpstreamPatchSet } from "@uniwork/office-engine/html";
import { openFixture, type OpenFixture } from "../ops/test-fixture";
import { elementByPath, type HtmlOpContext } from "../ops";
import { useHtmlInlineEdit, type HtmlInlineEditCommands, type HtmlInlineEditController, type HtmlInlineEditPort, type InlineEditInspector } from "./index";

/** A mutable flag mock, the pattern the H5/H6 suites use. */
const flagMock = vi.hoisted(() => ({ value: false }));
vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_selection" ? flagMock.value : fallback),
}));

beforeEach(() => {
  flagMock.value = false;
});
afterEach(() => {
  vi.restoreAllMocks();
});

const SOURCE = `<main id="m"><h1>Chào</h1><p class="a">Đoạn <b>đậm</b> thường</p><p class="b">Hai</p></main>`;

function contextOf(f: OpenFixture): HtmlOpContext {
  return { text: f.text, map: f.map, version: f.version };
}

function sid(f: OpenFixture, path: string): number {
  const element = elementByPath(f.map, path);
  if (!element) throw new Error("path missing: " + path);
  return element.sid;
}

const P1 = "main:nth-of-type(1) > p:nth-of-type(1)";
const H1 = "main:nth-of-type(1) > h1:nth-of-type(1)";

/** A fake host port: a recording inspector, a fixed context and a recording apply. */
function fakePort(f: OpenFixture, inspector: InlineEditInspector = { command: vi.fn(() => true) }) {
  const command = inspector.command as ReturnType<typeof vi.fn>;
  const apply = vi.fn((_set: UpstreamPatchSet) => true);
  const port: HtmlInlineEditPort = { inspector, context: () => contextOf(f), apply };
  return { port, command, apply };
}

describe("useHtmlInlineEdit — flag OFF sends nothing and applies nothing", () => {
  it("sends no inspector command and applies no op, even on a valid commit", async () => {
    flagMock.value = false;
    const f = await openFixture(SOURCE);
    const sink = createPreviewEventSink();
    const { port, command, apply } = fakePort(f);
    const { result } = renderHook(() =>
      useHtmlInlineEdit({ sink, selection: { sid: sid(f, P1), rect: { x: 0, y: 0, width: 10, height: 10 }, nodeName: null }, port }),
    );

    // The toolbar gets no callbacks, so its controls render disabled.
    const controller: HtmlInlineEditController = result.current;
    const commands: HtmlInlineEditCommands = controller.commands;
    expect(commands).toEqual({});

    act(() => sink.emit({ type: "text-edit-commit", sid: sid(f, P1), text: "Mới" }));
    result.current.commands.onEditText?.();
    result.current.commands.onMoveUp?.();
    result.current.commands.onMoveDown?.();
    expect(result.current.resize({ width: 100 })).toBe(false);

    expect(command).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
  });
});

describe("useHtmlInlineEdit — flag ON", () => {
  beforeEach(() => {
    flagMock.value = true;
  });

  it("edit text sends begin-text-edit for the selected sid", async () => {
    const f = await openFixture(SOURCE);
    const sink = createPreviewEventSink();
    const { port, command } = fakePort(f);
    const { result } = renderHook(() =>
      useHtmlInlineEdit({ sink, selection: { sid: sid(f, P1), rect: { x: 0, y: 0, width: 10, height: 10 }, nodeName: null }, port }),
    );
    result.current.commands.onEditText?.();
    expect(command).toHaveBeenCalledWith({ type: "begin-text-edit", sid: sid(f, P1) });
  });

  it("a text-edit-commit produces the expected set_inner_html op", async () => {
    const f = await openFixture(SOURCE);
    const sink = createPreviewEventSink();
    const { port, apply } = fakePort(f);
    const p1 = sid(f, P1);
    const { result } = renderHook(() => useHtmlInlineEdit({ sink, selection: { sid: p1, rect: null, nodeName: null }, port }));
    void result;

    act(() => sink.emit({ type: "text-edit-commit", sid: p1, text: "Đoạn mạnh" }));
    expect(apply).toHaveBeenCalledOnce();
    const set = apply.mock.calls[0]![0];
    expect(set.label).toBe("set_inner_html");
    const element = elementByPath(f.map, P1)!;
    expect(set.patches).toEqual([{ from: element.inner[0], to: element.inner[1], text: "Đoạn mạnh" }]);
    expect(set.baseVersion).toBe(f.version);
  });

  it("a text-edit-commit on a plain-text element produces set_text", async () => {
    const f = await openFixture(SOURCE);
    const sink = createPreviewEventSink();
    const { port, apply } = fakePort(f);
    const { result } = renderHook(() =>
      useHtmlInlineEdit({ sink, selection: { sid: sid(f, H1), rect: null, nodeName: null }, port }),
    );
    void result;
    act(() => sink.emit({ type: "text-edit-commit", sid: sid(f, H1), text: "a & b" }));
    expect(apply.mock.calls[0]![0].label).toBe("set_text");
  });

  it("rejects a malformed commit payload: no op is applied", async () => {
    const f = await openFixture(SOURCE);
    const sink = createPreviewEventSink();
    const { port, apply } = fakePort(f);
    renderHook(() => useHtmlInlineEdit({ sink, selection: { sid: sid(f, P1), rect: null, nodeName: null }, port }));

    const malformed: unknown[] = [
      { type: "text-edit-commit", sid: 0, text: "x" },
      { type: "text-edit-commit", sid: sid(f, P1), text: 42 },
      { type: "text-edit-commit" },
      { type: "select", sid: sid(f, P1) },
      null,
      "text-edit-commit",
    ];
    for (const payload of malformed) act(() => sink.emit(payload));
    expect(apply).not.toHaveBeenCalled();
  });

  it("applies nothing when no context is available (no engine session)", async () => {
    const f = await openFixture(SOURCE);
    const sink = createPreviewEventSink();
    const apply = vi.fn(() => true);
    const port: HtmlInlineEditPort = { inspector: { command: vi.fn(() => true) }, context: () => null, apply };
    renderHook(() => useHtmlInlineEdit({ sink, selection: { sid: sid(f, P1), rect: null, nodeName: null }, port }));
    act(() => sink.emit({ type: "text-edit-commit", sid: sid(f, P1), text: "Mới" }));
    expect(apply).not.toHaveBeenCalled();
  });

  it("move up/down apply the move op; the edge of the list applies nothing", async () => {
    const f = await openFixture(SOURCE);
    const sink = createPreviewEventSink();
    const { port, apply } = fakePort(f);
    const { result } = renderHook(() =>
      useHtmlInlineEdit({ sink, selection: { sid: sid(f, P1), rect: null, nodeName: null }, port }),
    );
    result.current.commands.onMoveUp?.();
    expect(apply.mock.calls[0]![0].label).toBe("move");

    // The first child has no previous sibling: nothing to move.
    const { port: port2, apply: apply2 } = fakePort(f);
    const second = renderHook(() =>
      useHtmlInlineEdit({ sink, selection: { sid: sid(f, H1), rect: null, nodeName: null }, port: port2 }),
    );
    second.result.current.commands.onMoveUp?.();
    expect(apply2).not.toHaveBeenCalled();
  });

  it("resize applies a set_style op with clamped pixels", async () => {
    const f = await openFixture(SOURCE);
    const sink = createPreviewEventSink();
    const { port, apply } = fakePort(f);
    const { result } = renderHook(() =>
      useHtmlInlineEdit({ sink, selection: { sid: sid(f, P1), rect: null, nodeName: null }, port }),
    );
    expect(result.current.resize({ width: 200.5, height: Number.NaN })).toBe(false);
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.resize({ width: 200.5 })).toBe(true);
    expect(apply.mock.calls[0]![0].label).toBe("set_style");
    expect(apply.mock.calls[0]![0].patches[0]!.text).toContain("width:201px");
  });
});

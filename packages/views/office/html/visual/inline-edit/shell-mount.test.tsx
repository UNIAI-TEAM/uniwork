// @vitest-environment jsdom
/**
 * H8 wired through the real shell: the shell merges the inline-edit bridge's
 * commands into the H6 float toolbar, so clicking "edit text" reaches the
 * injected host port's inspector channel, and a frame `text-edit-commit` is
 * applied as an H3 op through the same port. These cases pin the integration
 * the unit tests cannot see - that the shell connects H5 -> H6 -> H8.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { UpstreamPatchSet } from "@uniwork/office-engine/html";
import { HtmlVisualShell } from "../shell";
import { openFixture, type OpenFixture } from "../ops/test-fixture";
import { elementByPath, type HtmlOpContext } from "../ops";
import type { HtmlInlineEditPort } from "./index";
import type { IsolatedPreviewPort, PreviewSession } from "../../../source-editor-types";

const flagMock = vi.hoisted(() => ({ value: false }));
vi.mock("@uniwork/core/feature-flags", () => ({
  useFlag: (key: string, fallback: boolean) => (key === "office_html_visual_selection" ? flagMock.value : fallback),
}));

initI18n();
beforeEach(async () => {
  flagMock.value = false;
  await setLocale("en");
});

const SOURCE = `<main id="m"><p class="a">Đoạn <b>đậm</b></p></main>`;
const P1 = "main:nth-of-type(1) > p:nth-of-type(1)";

function contextOf(f: OpenFixture): HtmlOpContext {
  return { text: f.text, map: f.map, version: f.version };
}

function previewPort() {
  const forwarded: ((event: { type: string }) => void)[] = [];
  const mount = vi.fn(async (options: { onEvent?: (event: { type: string }) => void }): Promise<PreviewSession> => {
    if (options.onEvent) forwarded.push(options.onEvent);
    return { dispose: vi.fn(), update: vi.fn(), inspector: { command: vi.fn(), close: vi.fn() } } as unknown as PreviewSession;
  });
  return { port: { mount } as IsolatedPreviewPort, emit: (event: Record<string, unknown>) => forwarded.forEach((send) => send(event as { type: string })) };
}

function portFor(f: OpenFixture) {
  const command = vi.fn(() => true);
  const apply = vi.fn((_set: UpstreamPatchSet) => true);
  const port: HtmlInlineEditPort = { inspector: { command }, context: () => contextOf(f), apply };
  return { port, command, apply };
}

async function renderShell(f: OpenFixture, preview: IsolatedPreviewPort, port: HtmlInlineEditPort) {
  render(
    <HtmlVisualShell
      documentKey="doc"
      text={f.text}
      viewMode="preview"
      onViewModeChange={() => undefined}
      preview={preview}
      zoom={100}
      onZoomChange={() => undefined}
      inlineEdit={port}
    />,
  );
  await waitFor(() => expect(screen.getByTestId("html-preview")).toBeInTheDocument());
}

function action(id: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-float-action="${id}"]`);
  if (!found) throw new Error(`float action ${id} not found`);
  return found;
}

describe("H8 through the shell", () => {
  it("flag OFF: the edit-text action sends no inspector command", async () => {
    flagMock.value = false;
    const f = await openFixture(SOURCE);
    const { port, emit } = previewPort();
    const { port: inline, command } = portFor(f);
    await renderShell(f, port, inline);

    act(() => emit({ type: "select", sid: elementByPath(f.map, P1)!.sid }));
    act(() => emit({ type: "rect", sid: elementByPath(f.map, P1)!.sid, rect: { x: 10, y: 20, width: 30, height: 40 } }));
    expect(screen.queryByTestId("html-float-toolbar")).toBeNull();
    expect(command).not.toHaveBeenCalled();
  });

  it("flag ON: clicking edit text sends begin-text-edit for the selected sid", async () => {
    flagMock.value = true;
    const f = await openFixture(SOURCE);
    const { port, emit } = previewPort();
    const { port: inline, command } = portFor(f);
    const sid = elementByPath(f.map, P1)!.sid;
    await renderShell(f, port, inline);

    act(() => emit({ type: "select", sid }));
    act(() => emit({ type: "rect", sid, rect: { x: 10, y: 20, width: 30, height: 40 } }));
    fireEvent.click(action("edit-text"));
    expect(command).toHaveBeenCalledWith({ type: "begin-text-edit", sid });
    expect(command).toHaveBeenCalledTimes(1);
  });

  it("flag ON: a text-edit-commit is applied as an H3 op through the port", async () => {
    flagMock.value = true;
    const f = await openFixture(SOURCE);
    const { port, emit } = previewPort();
    const { port: inline, apply } = portFor(f);
    const sid = elementByPath(f.map, P1)!.sid;
    await renderShell(f, port, inline);

    act(() => emit({ type: "select", sid }));
    act(() => emit({ type: "rect", sid, rect: { x: 10, y: 20, width: 30, height: 40 } }));
    act(() => emit({ type: "text-edit-commit", sid, text: "Mới" }));

    expect(apply).toHaveBeenCalledOnce();
    const element = elementByPath(f.map, P1)!;
    expect(apply.mock.calls[0]![0].patches).toEqual([{ from: element.inner[0], to: element.inner[1], text: "Mới" }]);
  });

  it("flag ON: a malformed commit applies nothing", async () => {
    flagMock.value = true;
    const f = await openFixture(SOURCE);
    const { port, emit } = previewPort();
    const { port: inline, apply } = portFor(f);
    const sid = elementByPath(f.map, P1)!.sid;
    await renderShell(f, port, inline);

    act(() => emit({ type: "select", sid }));
    act(() => emit({ type: "rect", sid, rect: { x: 10, y: 20, width: 30, height: 40 } }));
    act(() => emit({ type: "text-edit-commit", sid: 0, text: "x" }));
    act(() => emit({ type: "text-edit-commit", sid, text: 42 }));
    expect(apply).not.toHaveBeenCalled();
  });
});

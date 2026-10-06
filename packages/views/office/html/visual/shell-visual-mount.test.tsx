// @vitest-environment jsdom
/**
 * The shell's visual-edit mount (ADR 0027): the isolated preview is asked for
 * the inspector capability only when the caller says `visualEdit`, and the
 * preview gets `previewText` (the sid-stamped copy) while the source pane keeps
 * the real text. A port that refuses the capability falls back to a plain,
 * script-free mount instead of leaving the pane empty.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import { HtmlVisualShell } from "./shell";
import type { IsolatedPreviewPort, PreviewMountOptions, PreviewSession } from "../../source-editor-types";

initI18n();
beforeEach(async () => {
  await setLocale("en");
});

/** What the shell passes the port: the base options plus the opt-in inspector request. */
type MountOptions = PreviewMountOptions & { visualEdit?: { nonce: string } };

function session(): PreviewSession {
  return { dispose: vi.fn(), update: vi.fn() };
}

function shell(preview: IsolatedPreviewPort, extra: Partial<Parameters<typeof HtmlVisualShell>[0]> = {}) {
  return (
    <HtmlVisualShell documentKey="d" text="<p>real</p>" viewMode="preview" onViewModeChange={() => undefined} preview={preview} zoom={100} {...extra} />
  );
}

describe("visual-edit mount", () => {
  it("without visualEdit the mount carries no capability request", async () => {
    const mount = vi.fn(async (_options: MountOptions) => session());
    render(shell({ mount }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(mount.mock.calls[0]![0]).not.toHaveProperty("visualEdit");
  });

  it("with visualEdit the mount carries a 32-hex nonce", async () => {
    const mount = vi.fn(async (_options: MountOptions) => session());
    render(shell({ mount }, { visualEdit: true }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    const options = mount.mock.calls[0]![0];
    expect(options.visualEdit?.nonce).toMatch(/^[0-9a-f]{32}$/);
  });

  it("mounts with the nonce the caller stamped the copy with", async () => {
    const mount = vi.fn(async (_options: MountOptions) => session());
    const nonce = "ab".repeat(16);
    render(shell({ mount }, { visualEdit: true, visualEditNonce: nonce }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    const options = mount.mock.calls[0]![0];
    expect(options.visualEdit?.nonce).toBe(nonce);
  });

  it("falls back to a plain mount when the port refuses the capability", async () => {
    const mount = vi.fn(async (options: MountOptions) => {
      if (options.visualEdit) throw new Error("preview unavailable: visual-edit is HTML-only and opt-in");
      return session();
    });
    render(shell({ mount }, { visualEdit: true }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(mount.mock.calls[1]![0]).not.toHaveProperty("visualEdit");
    await waitFor(() => expect(screen.queryByText("Preview unavailable")).not.toBeInTheDocument());
  });

  it("mounts the stamped preview copy while the source stays the real text", async () => {
    const mount = vi.fn(async (_options: MountOptions) => session());
    render(shell({ mount }, { previewText: '<p data-sid="1">real</p>', viewMode: "split" }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    expect(mount.mock.calls[0]![0].text).toBe('<p data-sid="1">real</p>');
  });

  it("remounts when visualEdit flips, so entering present drops the inspector", async () => {
    const mount = vi.fn(async (_options: MountOptions) => session());
    const view = render(shell({ mount }, { visualEdit: true }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(1));
    view.rerender(shell({ mount }, { visualEdit: false }));
    await waitFor(() => expect(mount).toHaveBeenCalledTimes(2));
    expect(mount.mock.calls[1]![0]).not.toHaveProperty("visualEdit");
  });
});

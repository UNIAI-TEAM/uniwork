// B8ui (UNI-927) - jsdom tests for the Media insert/replace control.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { initI18n, setLocale } from "@uniwork/core/i18n";
import type { PptxMediaEdit } from "./media-model";
import { installMediaPanelI18n } from "./install-media-i18n";
import { PptxMediaPanel, type PptxMediaPanelProps } from "./pptx-media-insert";

initI18n();
installMediaPanelI18n();
beforeEach(async () => {
  await setLocale("en");
});

function fileOf(name: string, body: number[] = [1, 2, 3, 4], type = ""): File {
  return new File([new Uint8Array(body)], name, { type });
}

function renderPanel(overrides: Partial<PptxMediaPanelProps> = {}) {
  const onSelect = vi.fn(async (_edit: PptxMediaEdit) => undefined);
  const onError = vi.fn();
  const element = (extra: Partial<PptxMediaPanelProps> = {}) => (
    <PptxMediaPanel
      onSelect={onSelect}
      onError={onError}
      slideCount={3}
      slideIndex={1}
      mediaElementId="pic1"
      {...overrides}
      {...extra}
    />
  );
  const view = render(element());
  return { view, rerender: (extra: Partial<PptxMediaPanelProps> = {}) => view.rerender(element(extra)), onSelect, onError };
}

const panel = () => document.querySelector("[data-pptx-media-panel]") as HTMLElement;
const input = (name: string) => document.querySelector(`[data-pptx-media-input="${name}"]`) as HTMLInputElement;

describe("PptxMediaPanel", () => {
  it("mounts the insert, poster and edit sections in one labelled panel", () => {
    renderPanel();
    expect(panel()).toHaveAttribute("data-state", "ready");
    expect(screen.getByRole("region", { name: "Media" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Video" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Audio" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Replace media" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Remove media" })).toBeEnabled();
  });

  it("reads a picked video and emits add_media with its bytes and extension", async () => {
    const { onSelect } = renderPanel();
    fireEvent.change(input("video"), { target: { files: [fileOf("clip.MP4", [9, 9, 9])] } });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    const edit = onSelect.mock.calls[0]![0] as { op: string; kind: string; ext: string; bytes: Uint8Array; wPx: number };
    expect(edit.op).toBe("add_media");
    expect(edit.kind).toBe("video");
    expect(edit.ext).toBe("mp4");
    expect(edit.bytes.length).toBe(3);
    expect(edit.wPx).toBeGreaterThan(0);
  });

  it("reads a picked audio file and emits an audio add_media", async () => {
    const { onSelect } = renderPanel();
    fireEvent.change(input("audio"), { target: { files: [fileOf("song.mp3")] } });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ op: "add_media", kind: "audio", ext: "mp3" });
  });

  it("refuses a non-media extension before the engine sees it", async () => {
    const { onSelect } = renderPanel();
    fireEvent.change(input("video"), { target: { files: [fileOf("deck.pptx")] } });
    const error = await screen.findByTestId("pptx-media-error");
    expect(error).toHaveTextContent("pptx is not a supported media format.");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("emits replace_picture for the selected media element's poster", async () => {
    const { onSelect } = renderPanel();
    fireEvent.change(input("replace"), { target: { files: [fileOf("poster.png")] } });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect(onSelect.mock.calls[0]![0]).toMatchObject({ op: "replace_picture", elementId: "pic1", ext: "png" });
  });

  it("emits delete_element for the selected media element", async () => {
    const { onSelect } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Remove media" }));
    await waitFor(() =>
      expect(onSelect).toHaveBeenCalledWith({ op: "delete_element", slideIndex: 1, elementId: "pic1" }),
    );
  });

  it("attaches a chosen poster to the next insert", async () => {
    const { onSelect } = renderPanel();
    fireEvent.change(input("poster"), { target: { files: [fileOf("frame.png")] } });
    await waitFor(() => expect(screen.getByTestId("pptx-media-poster-state")).toHaveTextContent("Poster: frame.png"));
    fireEvent.change(input("video"), { target: { files: [fileOf("clip.mp4")] } });
    await waitFor(() => expect(onSelect).toHaveBeenCalledTimes(1));
    expect((onSelect.mock.calls[0]![0] as { poster?: { ext: string } }).poster).toEqual({ bytes: expect.any(Uint8Array), ext: "png" });
  });

  it("reports a refused edit and keeps the document claim honest", async () => {
    const onSelect = vi.fn(async () => {
      throw new Error("media_bad_bytes");
    });
    const onError = vi.fn();
    renderPanel({ onSelect, onError });
    fireEvent.click(screen.getByRole("button", { name: "Remove media" }));
    const alert = await screen.findByTestId("pptx-media-error");
    expect(alert).toHaveTextContent("The media change could not be applied");
    expect(alert).toHaveTextContent("media_bad_bytes");
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("renders the loading state as a busy status region", () => {
    renderPanel({ loading: true });
    expect(panel()).toHaveAttribute("data-state", "loading");
    expect(screen.getByRole("status", { name: "Loading the media tools..." })).toHaveAttribute("aria-busy", "true");
  });

  it("renders the empty state for a deck with no slides", () => {
    renderPanel({ slideCount: 0, slideIndex: null });
    expect(panel()).toHaveAttribute("data-state", "empty");
    expect(panel()).toHaveTextContent("Select a slide to insert media");
  });

  it("disables every control and says so when no edit channel is bound", () => {
    renderPanel({ onSelect: undefined });
    expect(screen.getByTestId("pptx-media-unbound")).toHaveTextContent("Media changes are not connected to this editor yet.");
    expect(screen.getByRole("button", { name: "Video" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove media" })).toBeDisabled();
  });

  it("disables the target controls in read-only mode and explains why", () => {
    renderPanel({ disabled: true });
    expect(screen.getByTestId("pptx-media-unbound")).toHaveTextContent("This presentation is read-only.");
    expect(screen.getByRole("button", { name: "Remove media" })).toBeDisabled();
  });

  it("keeps Replace/Remove honest when no media element is selected", () => {
    const { onSelect } = renderPanel({ mediaElementId: null });
    expect(screen.getByRole("button", { name: "Remove media" })).toBeDisabled();
    expect(screen.getByTestId("pptx-media-no-target")).toHaveTextContent("Select an audio or video element on the slide first.");
    // Insert stays usable: it does not need a media target.
    expect(screen.getByRole("button", { name: "Video" })).toBeEnabled();
    expect(onSelect).not.toHaveBeenCalled();
  });
});
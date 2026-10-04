"use client";

/**
 * Media tab body (B8ui, UNI-927). The self-contained panel the serialized
 * UI-wire round mounts in the Insert > Media context: insert audio, insert
 * video (with an optional poster image), replace the selected element's poster
 * and remove the selected media element - every control calls ONE async port
 * with exactly one registered engine edit:
 *
 *   onSelect?(edit: PptxMediaEdit): Promise<unknown>   // the engine edit channel
 *   onError?(error: unknown): void                     // host reporting seam
 *
 * The wire round binding is one line: `(edit) => handle.edit([edit])` (or
 * `model.applyEdit(edit)`). With no port bound, no deck or no media element
 * selected, the affected controls are disabled and the panel says why - it
 * never fakes a capability (the lane's honesty rule).
 *
 * The picked file is read in the renderer (no Node, no upload) with the same
 * jsdom-safe `arrayBuffer` -> `FileReader` fallback the Insert panel's picture
 * control uses, and an unsupported extension is refused BEFORE the engine sees
 * it, so the user gets a typed message instead of a failed transaction.
 *
 * States: loading (a probe is in flight), empty (no deck), ready, busy (an edit
 * is applying), error (the last edit was refused; the message is shown and the
 * document is unchanged). The document is only ever mutated by `onSelect`.
 */
import { useCallback, useRef, useState } from "react";
import { FileAudio, FileVideo, ImagePlus, RefreshCw, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Alert, AlertDescription, AlertTitle } from "@uniwork/ui/components/ui/alert";
import { Button } from "@uniwork/ui/components/ui/button";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import {
  PPTX_MEDIA_AUDIO_ACCEPT,
  PPTX_MEDIA_POSTER_ACCEPT,
  PPTX_MEDIA_VIDEO_ACCEPT,
  buildAddMediaEdit,
  buildRemoveMediaEdit,
  buildReplaceMediaEdit,
  isPosterExt,
  mediaExtFromName,
  mediaKindFromExt,
  type PptxMediaEdit,
  type PptxMediaKind,
  type PptxMediaPoster,
} from "./media-model";

export interface PptxMediaPanelProps {
  /** The engine edit channel (one registered edit per call). Absent -> every
   *  control is disabled with the "not bound" reason. */
  onSelect?: (edit: PptxMediaEdit) => Promise<unknown>;
  /** A refused edit surfaces here as well as in the panel's own alert. */
  onError?: (error: unknown) => void;
  /** Deck slide count; 0 means "no deck" and the panel shows its empty state. */
  slideCount?: number;
  /** 0-based selected slide; null when nothing is selected. */
  slideIndex?: number | null;
  /**
   * The selected media element id, or null when the host tracked the selection
   * and found no media. Omit it when the host does not track media selection at
   * all, leaving Replace/Remove available.
   */
  mediaElementId?: string | null;
  /** A probe (capability/asset read) is in flight. */
  loading?: boolean;
  /** Explicit read-only mode (viewer permissions). */
  disabled?: boolean;
  className?: string;
}

/**
 * Read a picked file to bytes. `File.arrayBuffer()` is the browser path; jsdom's
 * `File` does not implement it, so fall back to `FileReader`, which jsdom does.
 */
async function readFileBytes(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === "function") {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      resolve(result ? new Uint8Array(result as ArrayBuffer) : new Uint8Array());
    };
    reader.onerror = () => reject(reader.error ?? new Error("pptx media read failed"));
    reader.readAsArrayBuffer(file);
  });
}

export function PptxMediaPanel({
  onSelect,
  onError,
  slideCount = 0,
  slideIndex = null,
  mediaElementId,
  loading = false,
  disabled = false,
  className,
}: PptxMediaPanelProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "office.pptx" });
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [poster, setPoster] = useState<{ bytes: Uint8Array; ext: string; name: string } | null>(null);
  const videoRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const posterRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  const bound = typeof onSelect === "function";
  const hasDeck = slideCount > 0;
  const blocked = disabled || !bound || !hasDeck || busy;
  const noTarget = mediaElementId === null;
  const needsTarget = blocked || noTarget;

  const run = useCallback(
    async (edit: PptxMediaEdit): Promise<boolean> => {
      if (!onSelect || busyRef.current) return false;
      busyRef.current = true;
      setBusy(true);
      setErrorMessage(null);
      try {
        await onSelect(edit);
        return true;
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : String(error));
        onError?.(error);
        return false;
      } finally {
        busyRef.current = false;
        setBusy(false);
      }
    },
    [onSelect, onError],
  );

  /** Refuse a bad extension with the panel's own copy, before any read. */
  const refuseExt = useCallback(
    (name: string, accept: "media" | "poster"): void => {
      const ext = mediaExtFromName(name);
      const given = ext ?? (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : name);
      const bad = accept === "poster" ? !isPosterExt(given) : mediaKindFromExt(given) === null;
      if (bad) {
        setErrorMessage(t(accept === "poster" ? "media.poster_unsupported" : "media.unsupported", { ext: given }));
      } else {
        setErrorMessage(null);
      }
    },
    [t],
  );

  const readFile = useCallback(async (file: File): Promise<Uint8Array | null> => {
    try {
      const bytes = await readFileBytes(file);
      if (bytes.length === 0) return null;
      return bytes;
    } catch {
      setErrorMessage(t("media.read_failed"));
      return null;
    }
  }, [t]);

  const insertMedia = useCallback(
    async (file: File, kind: PptxMediaKind): Promise<void> => {
      const ext = mediaExtFromName(file.name);
      if (!ext || mediaKindFromExt(ext) !== kind) {
        refuseExt(file.name, "media");
        return;
      }
      if (slideIndex === null) return;
      setErrorMessage(null);
      const bytes = await readFile(file);
      if (!bytes) return;
      const built = buildAddMediaEdit({
        slideIndex,
        kind,
        ext,
        bytes,
        ...(poster ? { poster: { bytes: poster.bytes, ext: poster.ext } } : {}),
        name: file.name,
      });
      if (!built.ok) {
        setErrorMessage(built.message);
        return;
      }
      await run(built.value);
    },
    [poster, readFile, refuseExt, run, slideIndex],
  );

  const replacePoster = useCallback(
    async (file: File): Promise<void> => {
      const ext = mediaExtFromName(file.name);
      if (!ext || !isPosterExt(ext)) {
        refuseExt(file.name, "poster");
        return;
      }
      if (slideIndex === null || !mediaElementId) return;
      setErrorMessage(null);
      const bytes = await readFile(file);
      if (!bytes) return;
      const built = buildReplaceMediaEdit({ slideIndex, elementId: mediaElementId, bytes, ext });
      if (!built.ok) {
        setErrorMessage(built.message);
        return;
      }
      await run(built.value);
    },
    [mediaElementId, readFile, refuseExt, run, slideIndex],
  );

  const pickPoster = useCallback(
    async (file: File): Promise<void> => {
      const ext = mediaExtFromName(file.name);
      if (!ext || !isPosterExt(ext)) {
        refuseExt(file.name, "poster");
        return;
      }
      setErrorMessage(null);
      const bytes = await readFile(file);
      if (!bytes) return;
      const next: PptxMediaPoster & { name: string } = { bytes, ext, name: file.name };
      setPoster(next);
    },
    [readFile, refuseExt],
  );

  const removeMedia = useCallback((): void => {
    if (slideIndex === null || !mediaElementId) return;
    const built = buildRemoveMediaEdit({ slideIndex, elementId: mediaElementId });
    if (!built.ok) {
      setErrorMessage(built.message);
      return;
    }
    void run(built.value);
  }, [mediaElementId, run, slideIndex]);

  if (loading) {
    return (
      <div
        role="status"
        aria-busy="true"
        aria-label={t("media.loading")}
        data-pptx-media-panel
        data-state="loading"
        className={cn("flex flex-col gap-3 p-3", className)}
      >
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-4 w-20" />
        <Skeleton className="h-10 w-full" />
      </div>
    );
  }

  if (!hasDeck) {
    return (
      <div data-pptx-media-panel data-state="empty" className={cn("p-3 text-caption text-muted-foreground", className)}>
        {t("media.empty")}
      </div>
    );
  }

  const blockedReason = disabled ? t("media.readonly") : !bound ? t("media.unbound") : null;

  return (
    <section
      aria-label={t("media.title")}
      data-pptx-media-panel
      data-state={busy ? "busy" : "ready"}
      className={cn("flex min-h-0 flex-col gap-4 overflow-y-auto p-3", className)}
    >
      {errorMessage ? (
        <Alert variant="destructive" data-testid="pptx-media-error">
          <AlertTitle>{t("media.error_title")}</AlertTitle>
          <AlertDescription>{t("media.error_hint", { message: errorMessage })}</AlertDescription>
        </Alert>
      ) : null}

      {busy ? (
        <p role="status" className="text-caption text-muted-foreground" data-testid="pptx-media-busy">
          {t("media.busy")}
        </p>
      ) : null}

      <div className="flex flex-col gap-2" data-pptx-media-insert>
        <span className="text-caption font-medium text-muted-foreground">{t("media.title")}</span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked || slideIndex === null}
            title={t("media.video.hint")}
            aria-describedby="pptx-media-insert-hint"
            data-pptx-media-action="video"
            onClick={() => videoRef.current?.click()}
          >
            <FileVideo aria-hidden="true" />
            <span className="text-label">{t("media.video.insert")}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={blocked || slideIndex === null}
            title={t("media.audio.hint")}
            aria-describedby="pptx-media-insert-hint"
            data-pptx-media-action="audio"
            onClick={() => audioRef.current?.click()}
          >
            <FileAudio aria-hidden="true" />
            <span className="text-label">{t("media.audio.insert")}</span>
          </Button>
        </div>
        <span id="pptx-media-insert-hint" className="text-caption text-muted-foreground">
          {t("media.video.hint")}
        </span>
      </div>

      <div className="flex flex-col gap-2" data-pptx-media-poster>
        <span className="text-caption font-medium text-muted-foreground">{t("media.poster_label")}</span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="w-fit"
          disabled={blocked}
          data-pptx-media-poster-pick
          onClick={() => posterRef.current?.click()}
        >
          <ImagePlus aria-hidden="true" />
          <span className="text-label">{t("media.poster_choose")}</span>
        </Button>
        <span className="text-caption text-muted-foreground" data-testid="pptx-media-poster-state">
          {poster ? t("media.poster_selected", { name: poster.name }) : t("media.poster_none")}
        </span>
      </div>

      <div className="flex flex-col gap-2" data-pptx-media-edit>
        <span className="text-caption font-medium text-muted-foreground">{t("media.replace")}</span>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={needsTarget}
            title={t("media.replace_hint")}
            data-pptx-media-action="replace"
            onClick={() => replaceRef.current?.click()}
          >
            <RefreshCw aria-hidden="true" />
            <span className="text-label">{t("media.replace")}</span>
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={needsTarget}
            title={t("media.remove_hint")}
            data-pptx-media-action="remove"
            onClick={removeMedia}
          >
            <Trash2 aria-hidden="true" />
            <span className="text-label">{t("media.remove")}</span>
          </Button>
        </div>
      </div>

      {noTarget ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-media-no-target">
          {t("media.no_target")}
        </p>
      ) : null}

      {blockedReason ? (
        <p className="text-caption text-muted-foreground" data-testid="pptx-media-unbound">
          {blockedReason}
        </p>
      ) : null}

      <input
        ref={videoRef}
        type="file"
        accept={PPTX_MEDIA_VIDEO_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-pptx-media-input="video"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertMedia(file, "video");
        }}
      />
      <input
        ref={audioRef}
        type="file"
        accept={PPTX_MEDIA_AUDIO_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-pptx-media-input="audio"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void insertMedia(file, "audio");
        }}
      />
      <input
        ref={posterRef}
        type="file"
        accept={PPTX_MEDIA_POSTER_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-pptx-media-input="poster"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void pickPoster(file);
        }}
      />
      <input
        ref={replaceRef}
        type="file"
        accept={PPTX_MEDIA_POSTER_ACCEPT}
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        data-pptx-media-input="replace"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file) void replacePoster(file);
        }}
      />
    </section>
  );
}
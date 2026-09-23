"use client";

import { useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { useReducedMotion } from "motion/react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";

/** True when a media URL or its alt marks it as an animation. */
export function isAnimatedChatImage(url: string, alt = ""): boolean {
  return alt.startsWith("gif:") || /\.gif(?:$|[?#])/i.test(url);
}

/**
 * A GIF that can be stopped (WCAG 2.2.2). An <img> cannot pause a GIF, so a
 * paused one shows the frame it had when it loaded, drawn on a canvas over
 * it. With reduced motion it starts paused and plays only when asked.
 */
export function ChatAnimatedImage({
  src,
  alt,
  className,
  imgClassName,
  onLoad,
  onError,
}: {
  src: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  onLoad?: (img: HTMLImageElement) => void;
  onError?: () => void;
}) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion() ?? false;
  const [choice, setChoice] = useState<boolean | null>(null);
  const playing = choice ?? !reduceMotion;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [frameReady, setFrameReady] = useState(false);

  const captureFrame = (img: HTMLImageElement) => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext?.("2d");
    if (!canvas || !context || !img.naturalWidth) return;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    try {
      context.drawImage(img, 0, 0);
      setFrameReady(true);
    } catch {
      // A frame we cannot draw leaves the image itself, still pausable by hiding.
    }
  };

  return (
    <span className={cn("relative inline-block max-w-full", className)}>
      <img
        src={src}
        alt={alt}
        loading="lazy"
        decoding="async"
        className={cn(imgClassName, !playing && "invisible")}
        onLoad={(event) => {
          captureFrame(event.currentTarget);
          onLoad?.(event.currentTarget);
        }}
        onError={onError}
      />
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn("absolute inset-0 size-full object-contain", (playing || !frameReady) && "hidden")}
      />
      <button
        type="button"
        aria-label={playing ? t("chat.message_list.gif_pause", { name: alt }) : t("chat.message_list.gif_play", { name: alt })}
        className="absolute right-1.5 bottom-1.5 inline-flex size-8 items-center justify-center rounded-full bg-surface-raised text-foreground shadow-[var(--menu-shadow)] transition-opacity duration-(--duration-fast) hover:bg-surface-hover pointer-coarse:size-11"
        onClick={() => setChoice(!playing)}
      >
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
      </button>
    </span>
  );
}

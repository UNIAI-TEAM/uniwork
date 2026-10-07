import { useEffect, useRef, useState, type RefObject } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@uniwork/ui/lib/utils";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import type { PreviewDocument, PreviewImage } from "./preview-source";

type PageImage = PreviewImage | "failed";

/** The page thumbnails of one preview document, drawn lazily: the pages the
 * scroller shows and the ones next to the current page. Without
 * IntersectionObserver (old webviews, jsdom) a wider window around the current
 * page stands in. Keyed by document: a new layout starts with a clean slate. */
export function PreviewPages({ source, current, onViewing, scrollerRef, aspect }: {
  source: PreviewDocument;
  current: number;
  /** The page most of the scroller shows, as the user scrolls. */
  onViewing(pageIndex: number): void;
  scrollerRef: RefObject<HTMLOListElement | null>;
  /** Width / height of one sheet, for the placeholder before its image arrives. */
  aspect: number;
}) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.print" });
  const [visible, setVisible] = useState<ReadonlySet<number>>(() => new Set());
  const [images, setImages] = useState<ReadonlyMap<number, PageImage>>(() => new Map());
  const requested = useRef(new Set<number>());
  const viewing = useRef(onViewing);
  const hasObserver = typeof IntersectionObserver !== "undefined";

  useEffect(() => { viewing.current = onViewing; }, [onViewing]);

  useEffect(() => {
    const scroller = scrollerRef.current;
    if (!hasObserver || !scroller) return;
    const ratios = new Map<number, number>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        const index = Number((entry.target as HTMLElement).dataset.pageIndex);
        ratios.set(index, entry.isIntersecting ? entry.intersectionRatio : 0);
      }
      const shown = [...ratios].filter(([, ratio]) => ratio > 0);
      setVisible(new Set(shown.map(([index]) => index)));
      // The most visible page wins; a tie goes to the earlier one.
      let best: [number, number] | null = null;
      for (const entry of shown) if (!best || entry[1] > best[1] || (entry[1] === best[1] && entry[0] < best[0])) best = entry;
      if (best) viewing.current(best[0]);
    }, { root: scroller, threshold: [0, 0.25, 0.5, 0.75, 1] });
    for (const slot of Array.from(scroller.children)) observer.observe(slot);
    return () => observer.disconnect();
  }, [hasObserver, scrollerRef, source]);

  useEffect(() => {
    const wanted = new Set(visible);
    const reach = hasObserver ? 1 : 2;
    for (let offset = -reach; offset <= reach; offset += 1) {
      const index = current + offset;
      if (index >= 0 && index < source.pageCount) wanted.add(index);
    }
    for (const index of wanted) {
      if (requested.current.has(index)) continue;
      requested.current.add(index);
      source.render(index).then(
        (image) => setImages((previous) => new Map(previous).set(index, image)),
        () => setImages((previous) => new Map(previous).set(index, "failed")),
      );
    }
  }, [source, visible, current, hasObserver]);

  return <ol ref={scrollerRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-md bg-surface-hover/60 p-3">
    {Array.from({ length: source.pageCount }, (_, index) => {
      const image = images.get(index);
      const ratio = image && image !== "failed" && image.width > 0 && image.height > 0 ? image.width / image.height : aspect;
      return <li
        key={index}
        data-page-index={index}
        data-testid="print-preview-page"
        aria-current={index === current ? "page" : undefined}
        style={{ aspectRatio: ratio }}
        className={cn("relative mx-auto w-full max-w-72 shrink-0 overflow-hidden rounded-sm bg-card shadow-sm ring-1 ring-surface-border", index === current && "ring-2 ring-primary")}
      >
        {image === undefined ? <Skeleton className="size-full rounded-none" /> : null}
        {image === "failed" ? <p className="flex size-full items-center justify-center p-2 text-center text-caption text-muted-foreground">{t("pageFailed")}</p> : null}
        {image && image !== "failed" ? <img src={image.src} alt={t("pageAlt", { page: index + 1 })} draggable={false} className="size-full object-contain" /> : null}
      </li>;
    })}
  </ol>;
}

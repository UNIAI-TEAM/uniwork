"use client";

import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TASK_PAGE_SIZE } from "@uniwork/core/tasks";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The button and live region behind every "load more" in the task surfaces.
 * One button element for both labels, so keyboard focus survives the switch
 * to retry; it stays in the tab order while a page is in flight
 * (`aria-disabled`), and the status beside it says what is happening.
 */
export function LoadMoreControls({
  isLoading,
  isError,
  onLoadMore,
}: {
  isLoading: boolean;
  isError: boolean;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();
  // A retry in flight is still loading; the failure only shows once it settles.
  const showError = isError && !isLoading;

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-disabled={isLoading}
        onClick={onLoadMore}
      >
        {showError ? t("common.retry") : t("tasks.pagination.load_more")}
      </Button>
      <span
        role="status"
        className={cn(
          "flex items-center gap-1.5 text-caption",
          showError ? "text-destructive" : "text-muted-foreground",
        )}
      >
        {isLoading ? (
          <>
            <Loader2 className="size-3 animate-spin" aria-hidden />
            {t("tasks.pagination.loading_more")}
          </>
        ) : showError ? (
          t("tasks.pagination.load_more_failed")
        ) : null}
      </span>
    </div>
  );
}

/**
 * Secondary path: asks for the next page when the end of the list scrolls
 * into view. The observer is built once and reads the latest callback through
 * a ref, so it fires once per visibility change and a page landing while the
 * end is still on screen does not fire again. Where IntersectionObserver is
 * missing it does nothing; the button always works.
 */
function AutoLoadSentinel({ onVisible }: { onVisible: () => void }) {
  const nodeRef = useRef<HTMLDivElement>(null);
  const onVisibleRef = useRef(onVisible);

  useEffect(() => {
    onVisibleRef.current = onVisible;
  }, [onVisible]);

  useEffect(() => {
    const node = nodeRef.current;
    if (!node || typeof IntersectionObserver === "undefined") return;
    let wasVisible = false;
    const observer = new IntersectionObserver(
      ([entry]) => {
        const visible = entry?.isIntersecting ?? false;
        if (visible && !wasVisible) onVisibleRef.current();
        wasVisible = visible;
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return <div ref={nodeRef} aria-hidden className="h-px w-full" />;
}

/**
 * End-of-list footer for offset-paged task lists, in four states:
 * a failed page → retry; pages left → load-more button plus an auto-load
 * sentinel; everything loaded after paging → a muted end marker; a list that
 * never needed a second page → nothing.
 */
export function LoadMoreFooter({
  hasMore,
  isLoading,
  isError,
  total,
  onLoadMore,
}: {
  hasMore: boolean;
  isLoading: boolean;
  isError: boolean;
  /** Tasks matching the list on the server; decides whether an end marker is worth showing. */
  total: number;
  onLoadMore: () => void;
}) {
  const { t } = useTranslation();

  if (hasMore) {
    return (
      <div data-testid="load-more-footer" className="flex flex-col items-center py-3">
        <LoadMoreControls
          isLoading={isLoading}
          isError={isError}
          onLoadMore={onLoadMore}
        />
        {/* No auto-retry: a page that keeps failing must not loop. */}
        {isError ? null : <AutoLoadSentinel onVisible={onLoadMore} />}
      </div>
    );
  }

  if (total > TASK_PAGE_SIZE) {
    return (
      <p
        data-testid="load-more-footer"
        className="py-3 text-center text-caption text-muted-foreground"
      >
        {t("tasks.pagination.end")}
      </p>
    );
  }

  return null;
}

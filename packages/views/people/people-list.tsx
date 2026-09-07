"use client";

import { useVirtualizer } from "@tanstack/react-virtual";
import { useEffect, useRef, useState } from "react";
import type { Person } from "@uniwork/core/types/people";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { PersonRow } from "./person-row";

/**
 * The directory list. A thousand-person company is the size this product is
 * built for (Vision §6.3), so once the viewport has been measured only the
 * visible window is rendered; rows have a fixed height, which is what makes a
 * plain virtualizer honest here.
 *
 * Until the viewport is measured — the first paint, a print, an environment
 * with no layout — every row is rendered instead. A zero-height measurement
 * means "we do not know what is visible", and showing nothing would read as an
 * empty directory.
 *
 * Paging is driven by the scroll position rather than a button: the last
 * rendered row asking for the next page is what an infinite list means.
 */
const ROW_HEIGHT = 57;
const OVERSCAN = 8;

interface PeopleListProps {
  people: Person[];
  onOpen: (userId: string) => void;
  hasNextPage: boolean;
  isFetchingNextPage: boolean;
  onLoadMore: () => void;
}

export function PeopleList({
  people,
  onOpen,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: PeopleListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const viewportHeight = useViewportHeight(scrollRef);
  const virtualizer = useVirtualizer({
    count: people.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: OVERSCAN,
    // Measure from the element's own box rather than waiting for the first
    // ResizeObserver callback: reporting on attach removes the blank frame
    // between mount and the first measurement.
    observeElementRect: (instance, report) => {
      const element = instance.scrollElement;
      if (!element) return;
      const measure = () => report({ width: element.clientWidth, height: element.clientHeight });
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
    },
  });
  const items = virtualizer.getVirtualItems();
  const virtualized = viewportHeight > 0;
  const lastRendered = virtualized
    ? (items[items.length - 1]?.index ?? 0)
    : people.length - 1;

  useEffect(() => {
    if (!hasNextPage || isFetchingNextPage) return;
    if (lastRendered >= people.length - 1) onLoadMore();
  }, [hasNextPage, isFetchingNextPage, lastRendered, onLoadMore, people.length]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
      {virtualized ? (
        <ul className="relative" style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const person = people[item.index];
            if (!person) return null;
            return (
              <PersonRow
                key={person.user_id}
                person={person}
                onOpen={onOpen}
                className="absolute inset-x-0 top-0 border-b border-border"
                style={{ height: item.size, transform: `translateY(${item.start}px)` }}
              />
            );
          })}
        </ul>
      ) : (
        <ul className="divide-y divide-border">
          {people.map((person) => (
            <PersonRow key={person.user_id} person={person} onOpen={onOpen} />
          ))}
        </ul>
      )}
      {isFetchingNextPage ? (
        <div className="flex justify-center p-4">
          <Spinner />
        </div>
      ) : null}
    </div>
  );
}

/** The scroll container's height, re-read whenever the element is resized. */
function useViewportHeight(ref: React.RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => setHeight(element.clientHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

"use client";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Skeleton } from "@uniwork/ui/components/ui/skeleton";
import { cn } from "@uniwork/ui/lib/utils";
import { MeetingsCrumb } from "./meetings-crumb";
import { DETAIL_GRID, DETAIL_SHEET } from "./layout";

/** One kit `.skel` bar, vertically centred in a line of `line` px. */
function Bar({ w, h = 12, className }: { w: string; h?: number; className?: string }) {
  return <Skeleton className={cn("max-w-full rounded-sm bg-border", className)} style={{ width: w, height: h }} />;
}

const ITEMS = [
  { w: "62%", meta: "240px" },
  { w: "44%", meta: "200px" },
  { w: "68%", meta: "220px" },
  { w: "52%", meta: "200px" },
];
/** Rail rows: label bar, then the value bars (`av` a 24 face first). */
const PROPS: { k: number; av?: boolean; v: number[] }[] = [
  { k: 48, av: true, v: [80] },
  { k: 44, av: true, v: [64] },
  { k: 52, av: true, v: [56, 72] },
  { k: 40, v: [128] },
  { k: 52, v: [136, 32] },
  { k: 48, v: [72] },
];
/** Outline rows: the entry, then its count (none on the first). */
const OUTLINE: [number, number?][] = [[56], [76, 72], [64, 16], [88, 12], [48, 12], [48, 12]];

/**
 * The meeting page while it loads (LoadingError crop 1): the real header,
 * strip, tabs, sections and rail with bars in place of text, so nothing moves
 * when the page arrives. No spinner: the shape is the signal.
 */
export function DetailSkeleton() {
  const { t } = useTranslation();
  return (
    <div role="status" aria-busy="true" className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <span className="sr-only">{t("meetings.detail.states.loading")}</span>
      <div aria-hidden className="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-4 text-body text-muted-foreground">
        <MeetingsCrumb />
        <ChevronRight className="size-3 text-faint-foreground" />
        <Bar w="240px" h={12} />
      </div>
      <div aria-hidden className="@container/meeting min-h-0 flex-1 overflow-hidden">
        {/* A phone page is drawn as the kit's 390 page (LoadingError at 390): 20 on top, wrapped title and actions. */}
        <div className={cn(DETAIL_SHEET, "@max-[37.5rem]/meeting:pt-5")}>
          <div className="flex min-h-8.25 items-center @max-[37.5rem]/meeting:block @max-[37.5rem]/meeting:pt-0.5">
            <Bar w="520px" h={24} />
            <Bar w="60%" h={24} className="hidden @max-[37.5rem]/meeting:mt-0.5 @max-[37.5rem]/meeting:block" />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 @max-[37.5rem]/meeting:gap-x-3">
            <Bar w="84px" h={22} />
            <Bar w="150px" />
            <div className="@max-[37.5rem]/meeting:basis-full">
              <Bar w="160px" />
            </div>
          </div>
          <div className="mt-6 flex min-h-14 items-center justify-between gap-6 border-y border-border py-4 @max-[37.5rem]/meeting:flex-col @max-[37.5rem]/meeting:items-stretch @max-[37.5rem]/meeting:gap-3">
            <div className="min-w-0">
              <div className="flex h-5 items-center">
                <Bar w="280px" />
              </div>
              <div className="mt-0.5 flex flex-col gap-1.5 py-0.75">
                <Bar w="400px" h={10} />
                <Bar w="40%" h={10} className="hidden @max-[37.5rem]/meeting:block" />
              </div>
            </div>
            <div className="flex gap-2 @max-[37.5rem]/meeting:flex-wrap">
              {[139, 124, 143].map((w) => (
                <Skeleton key={w} className="h-9 max-w-full rounded-control bg-border @max-[37.5rem]/meeting:h-11 @max-[37.5rem]/meeting:grow" style={{ width: w }} />
              ))}
            </div>
          </div>
          <div className={cn(DETAIL_GRID, "mt-4")}>
            <div className="min-w-0">
              <div className="flex h-11 items-center gap-6 border-b border-border">
                <Bar w="64px" />
                <Bar w="84px" />
                <Bar w="96px" />
              </div>
              <div className="mt-10 @max-[37.5rem]/meeting:mt-8">
                <div className="flex h-5.5 items-center">
                  <Bar w="72px" h={14} />
                </div>
                <Bar w="400px" h={10} className="mt-2" />
                <div className="mt-3.5 flex max-w-160 flex-col gap-2.5 py-1.25">
                  {["100%", "96%", "100%", "92%", "48%"].map((w, i) => (
                    <Bar key={i} w={w} />
                  ))}
                </div>
              </div>
              <div className="mt-10 @max-[37.5rem]/meeting:mt-8">
                <div className="flex h-6 items-center gap-2">
                  <Bar w="104px" h={14} />
                  <Bar w="120px" h={10} />
                </div>
                <Bar w="300px" h={10} className="mt-2" />
                <Bar w="150px" h={10} className="mt-6.25" />
                <div className="mt-2.25">
                  {ITEMS.map((item, i) => (
                    <div key={i} className="grid grid-cols-[16px_minmax(0,1fr)_36px] items-center gap-x-3 pt-2.5 pb-2.25">
                      <Bar w="16px" h={16} className="rounded-[4px]" />
                      <Bar w={item.w} />
                      <Bar w="36px" />
                      <Bar w={item.meta} h={10} className="col-start-2 mt-2.75" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="flex min-w-0 flex-col border-l border-border pl-6 @max-[58rem]/meeting:order-first @max-[58rem]/meeting:mb-2 @max-[58rem]/meeting:border-b @max-[58rem]/meeting:border-l-0 @max-[58rem]/meeting:pb-3 @max-[58rem]/meeting:pl-0">
              {PROPS.map((row, i) => (
                <div key={i} className="grid min-h-8 grid-cols-[14px_70px_minmax(0,1fr)] items-center gap-x-2 py-1.5 @max-[37.5rem]/meeting:grid-cols-[14px_84px_minmax(0,1fr)]">
                  <Bar w="14px" h={14} />
                  <Bar w={`${row.k}px`} h={10} />
                  <div className="flex min-w-0 items-center gap-1.5">
                    {row.av ? <Bar w="24px" h={24} className="-my-0.5 shrink-0 rounded-full" /> : null}
                    {row.v.map((w, j) => (
                      <Bar key={j} w={`${w}px`} className="min-w-0" />
                    ))}
                  </div>
                </div>
              ))}
              <div className="@max-[58rem]/meeting:hidden">
                <div className="mt-4 border-t border-border pt-5">
                  <Bar w="88px" h={10} />
                  <div className="mt-2">
                    {OUTLINE.map(([w, n], i) => (
                      <div key={i} className="flex h-7 items-center justify-between pr-2">
                        <Bar w={`${w}px`} h={10} />
                        {n ? <Bar w={`${n}px`} h={10} /> : null}
                      </div>
                    ))}
                  </div>
                </div>
                <div className="mt-4 flex h-8 items-center border-t border-border pt-4 box-content">
                  <Bar w="112px" />
                </div>
                <Bar w="100%" h={44} className="mt-6 rounded-control" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

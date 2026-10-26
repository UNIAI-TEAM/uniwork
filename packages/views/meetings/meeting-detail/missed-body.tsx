"use client";
import { DescriptionSection } from "./canceled-body";
import { CarriedOverBrief } from "./scheduled/carried-over-brief";

/**
 * The missed page (Missed board): the agenda, then the work still open from
 * earlier meetings folded to one heading line ("Việc còn tồn 4 ›") — it was
 * meant for a meeting that did not happen, so it waits until asked for.
 */
export function MissedBody() {
  return (
    <>
      <DescriptionSection />
      <CarriedOverBrief variant="line" lineSummary={false} />
    </>
  );
}

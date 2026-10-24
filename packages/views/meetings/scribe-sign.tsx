"use client";
import { useTranslation } from "react-i18next";
import { ScribeMark, type ScribeMarkState } from "@uniwork/ui/brand/scribe-mark";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * Thư ký UNI's mark standing in for its name at the head of a line it wrote
 * ("[mark] Soạn 09:31 22/10 …", "[mark] Ghi lúc 09:06"): no word beside it
 * says who, so the name is read out and shown on hover.
 */
export function ScribeSign({ state, className }: { state?: ScribeMarkState; className?: string }) {
  const { t } = useTranslation();
  const name = t("meetings.scribe.name");
  return (
    <span title={name} className={cn("mr-1.5 inline-flex align-[-3px]", className)}>
      <ScribeMark state={state} className="size-3.5" />
      <span className="sr-only">{`${name}: `}</span>
    </span>
  );
}

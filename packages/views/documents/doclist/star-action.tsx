"use client";

import { Star } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";
import type { RowMenuGroup } from "./row-menu";

// The quick Star button of a live row, beside the ⋯ menu (contract UNI-2045 →
// Thao tác: "live: hàng = Sao · ⋯"). It repeats the menu's own `star` item, so
// it exists exactly where the menu offers one (never on a shelved or trashed
// row, never without a host handler) and runs the same toggle. A starred row
// draws the filled star; `aria-pressed` carries the state for assistive tech.

export function DocStarAction({ menu, title, starred }: { menu: readonly RowMenuGroup[]; title: string; starred: boolean }) {
  const { t } = useTranslation();
  const item = menu.flat().find((entry) => entry.id === "star");
  if (!item) return null;
  const label = t(starred ? "documents.home.row.unstar" : "documents.home.row.star");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="pointer-coarse:size-11"
            aria-pressed={starred}
            aria-label={t(starred ? "documents.home.row.unstar_item" : "documents.home.row.star_item", { title })}
            onClick={item.run}
          />
        }
      >
        <Star aria-hidden className={cn(starred && "fill-current text-brand")} />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

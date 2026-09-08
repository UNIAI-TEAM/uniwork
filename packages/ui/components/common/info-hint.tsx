"use client";

import type { ReactNode } from "react";
import { InfoIcon } from "lucide-react";
import { Button } from "@uniwork/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@uniwork/ui/components/ui/tooltip";
import { cn } from "@uniwork/ui/lib/utils";

export function InfoHint({
  children,
  label,
  className,
  side = "top",
}: {
  children: ReactNode;
  label: string;
  className?: string;
  side?: "top" | "bottom" | "left" | "right";
}) {
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              "size-5 shrink-0 text-muted-foreground hover:bg-transparent hover:text-foreground",
              className,
            )}
            aria-label={label}
          />
        }
      >
        <InfoIcon className="size-3.5" aria-hidden />
      </TooltipTrigger>
      <TooltipContent side={side} className="max-w-xs text-pretty">
        {children}
      </TooltipContent>
    </Tooltip>
  );
}

import { cn } from "@uniwork/ui/lib/utils";

/** DialogContent className for manual create mode — depends on isExpanded. */
export function manualDialogContentClass(isExpanded: boolean): string {
  return cn(
    "flex flex-col gap-0 overflow-hidden p-0",
    "!top-1/2 !left-1/2 !-translate-x-1/2",
    "!transition-[width,height,max-width,transform] !duration-300 !ease-out motion-reduce:!transition-none",
    // Phone gutter: !important widths beat DialogContent defaults and its
    // max-w-[calc(100%-2rem)] safety margin beside the viewport edge.
    "!w-full !max-w-[calc(100vw-1.5rem)]",
    isExpanded
      ? "!h-5/6 !-translate-y-1/2 sm:!max-w-4xl"
      : "!h-96 !-translate-y-1/2 sm:!max-w-2xl",
  );
}

/** DialogContent className for agent create mode. */
export function agentDialogContentClass(isExpanded: boolean): string {
  return cn(
    "flex flex-col gap-0 overflow-hidden p-0",
    "!top-1/2 !left-1/2 !-translate-x-1/2 !-translate-y-1/2",
    "!transition-[width,height,max-width,transform] !duration-300 !ease-out motion-reduce:!transition-none",
    "!w-full !max-w-[calc(100vw-1.5rem)]",
    isExpanded ? "!h-5/6 sm:!max-w-4xl" : "!max-h-[80dvh] sm:!max-w-xl",
  );
}

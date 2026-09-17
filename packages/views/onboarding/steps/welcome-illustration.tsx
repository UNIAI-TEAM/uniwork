"use client";
import { ListChecks, MessagesSquare, Video, type LucideIcon } from "lucide-react";
import { IconTile } from "@uniwork/ui/components/common/icon-tile";
import { cn } from "@uniwork/ui/lib/utils";
import { MODULE_TONES } from "../../layout/module-tones";

/**
 * Tasks, meetings and chat stacked like sheets of paper beside the welcome
 * headline: one surface for the work the team already does.
 *
 * Deliberately wordless. It used to be five invented cards (named teammates,
 * task ids, a meeting at 14:00, "10 phút trước"); PRODUCT.md bans mock data
 * anywhere, and a first-run screen showing activity that does not exist is
 * exactly the claim it rules out. Each card is now a module in its own tint
 * with bars where text would be, so it reads as a picture of the product's
 * shape, never as someone's data.
 */
const CARDS: { icon: LucideIcon; tone: (typeof MODULE_TONES)[keyof typeof MODULE_TONES]; place: string; lines: [string, string] }[] = [
  { icon: ListChecks, tone: MODULE_TONES.tasks, place: "", lines: ["w-3/5", "w-4/5"] },
  { icon: Video, tone: MODULE_TONES.meetings, place: "-translate-x-5 -rotate-[1.2deg]", lines: ["w-2/5", "w-3/4"] },
  { icon: MessagesSquare, tone: MODULE_TONES.chat, place: "translate-x-8 rotate-[1.6deg]", lines: ["w-1/2", "w-2/3"] },
  { icon: ListChecks, tone: MODULE_TONES.tasks, place: "-translate-x-6 -rotate-[0.8deg]", lines: ["w-2/3", "w-1/2"] },
];

export function WelcomeIllustration() {
  return (
    <div aria-hidden className="flex w-full max-w-[460px] flex-col gap-3">
      {CARDS.map(({ icon, tone, place, lines }, i) => (
        <div
          key={i}
          className={cn("flex items-center gap-4 rounded-xl border border-border bg-surface px-4 py-4 shadow-surface", place)}
        >
          <IconTile icon={icon} tone={tone} size="md" className="[&_svg]:stroke-[1.5]" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <span className={cn("h-2.5 rounded-full bg-foreground/15", lines[0])} />
            <span className={cn("h-2 rounded-full bg-border", lines[1])} />
          </div>
        </div>
      ))}
    </div>
  );
}

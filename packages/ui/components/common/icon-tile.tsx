import type { ComponentProps } from "react";
import type { LucideIcon } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The tints declared in styles/tokens.css. A tint identifies a module or a
 * category (tasks, meetings, a status, a priority); live state is reported
 * through the signal colours (success / warning / destructive / info).
 */
export const TINTS = ["violet", "blue", "pink", "orange", "green", "yellow", "teal", "gray", "red"] as const;
export type Tint = (typeof TINTS)[number];

/** Pale fill + saturated glyph/text. Spelled out so Tailwind sees every class. */
export const tintClass: Record<Tint, string> = {
  violet: "bg-tint-violet text-tint-violet-foreground",
  blue: "bg-tint-blue text-tint-blue-foreground",
  pink: "bg-tint-pink text-tint-pink-foreground",
  orange: "bg-tint-orange text-tint-orange-foreground",
  green: "bg-tint-green text-tint-green-foreground",
  yellow: "bg-tint-yellow text-tint-yellow-foreground",
  teal: "bg-tint-teal text-tint-teal-foreground",
  gray: "bg-tint-gray text-tint-gray-foreground",
  red: "bg-tint-red text-tint-red-foreground",
};

/** Glyph-only colour of a tint, for an icon or flag on a neutral surface. */
export const tintForegroundClass: Record<Tint, string> = {
  violet: "text-tint-violet-foreground",
  blue: "text-tint-blue-foreground",
  pink: "text-tint-pink-foreground",
  orange: "text-tint-orange-foreground",
  green: "text-tint-green-foreground",
  yellow: "text-tint-yellow-foreground",
  teal: "text-tint-teal-foreground",
  gray: "text-tint-gray-foreground",
  red: "text-tint-red-foreground",
};

/** Saturated fill under the on-solid glyph/text: nav tiles, status pills, count badges. */
export const tintSolidClass: Record<Tint, string> = {
  violet: "bg-tint-violet-solid text-on-solid",
  blue: "bg-tint-blue-solid text-on-solid",
  pink: "bg-tint-pink-solid text-on-solid",
  orange: "bg-tint-orange-solid text-on-solid",
  green: "bg-tint-green-solid text-on-solid",
  yellow: "bg-tint-yellow-solid text-on-solid",
  teal: "bg-tint-teal-solid text-on-solid",
  gray: "bg-tint-gray-solid text-on-solid",
  red: "bg-tint-red-solid text-on-solid",
};

const iconTileVariants = cva(
  "inline-flex shrink-0 items-center justify-center [&_svg]:shrink-0",
  {
    variants: {
      size: {
        xs: "size-5 rounded-[5px] [&_svg]:size-3",
        sm: "size-7 rounded-md [&_svg]:size-3.5",
        md: "size-10 rounded-lg [&_svg]:size-5",
        lg: "size-12 rounded-xl [&_svg]:size-6",
      },
      tone: {
        violet: "", blue: "", pink: "", orange: "", green: "",
        yellow: "", teal: "", gray: "", red: "",
        muted: "bg-muted text-muted-foreground",
        destructive: "bg-destructive/10 text-destructive",
        warning: "bg-warning/10 text-warning",
      },
      variant: {
        soft: "",
        solid: "",
      },
    },
    compoundVariants: [
      ...TINTS.map((tint) => ({ tone: tint, variant: "soft" as const, className: tintClass[tint] })),
      ...TINTS.map((tint) => ({ tone: tint, variant: "solid" as const, className: tintSolidClass[tint] })),
    ],
    defaultVariants: { size: "md", tone: "muted", variant: "soft" },
  },
);

export type IconTileTone = NonNullable<VariantProps<typeof iconTileVariants>["tone"]>;

interface IconTileProps
  extends Omit<ComponentProps<"span">, "children">, VariantProps<typeof iconTileVariants> {
  icon: LucideIcon;
}

/**
 * A coloured square with a glyph — the module / category mark used by nav,
 * empty states, page headers and feature rows. `soft` is a pastel fill with
 * a saturated glyph; `solid` is the saturated fill with a white glyph.
 * Decorative by default: the label lives in the adjacent text, so the tile
 * is `aria-hidden`.
 */
export function IconTile({ icon: Icon, size, tone, variant, className, ...props }: IconTileProps) {
  return (
    <span
      aria-hidden="true"
      data-slot="icon-tile"
      data-tone={tone ?? "muted"}
      data-variant={variant ?? "soft"}
      className={cn(iconTileVariants({ size, tone, variant }), className)}
      {...props}
    >
      <Icon />
    </span>
  );
}

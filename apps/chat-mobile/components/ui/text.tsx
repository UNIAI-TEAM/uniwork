// Ported from usf apps/mobile/components/ui/text.tsx (React Native Reusables).
import { Slot } from "@rn-primitives/slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { Platform, Text as RNText, type Role } from "react-native";
import { cn } from "@/lib/utils";

const textVariants = cva(cn("font-sans text-foreground text-body", Platform.select({ web: "select-text" })), {
  variants: {
    variant: {
      default: "",
      h1: cn("text-center text-display-xl font-display font-extrabold tracking-tight", Platform.select({ web: "scroll-m-20 text-balance" })),
      h2: cn("border-border border-b pb-2 text-display-lg font-semibold tracking-tight", Platform.select({ web: "scroll-m-20 first:mt-0" })),
      h3: cn("text-display-sm font-semibold tracking-tight", Platform.select({ web: "scroll-m-20" })),
      h4: cn("text-title2 font-semibold tracking-tight", Platform.select({ web: "scroll-m-20" })),
      p: "mt-3 leading-7 sm:mt-6",
      blockquote: "mt-4 border-l-2 pl-3 italic sm:mt-6 sm:pl-6",
      code: "bg-muted relative rounded-xs px-[0.3rem] py-[0.2rem] font-mono text-callout font-semibold",
      lead: "text-muted-foreground text-title2",
      large: "text-title3 font-semibold",
      small: "text-callout font-medium leading-none",
      muted: "text-muted-foreground text-callout",
    },
  },
  defaultVariants: { variant: "default" },
});

type TextVariantProps = VariantProps<typeof textVariants>;
type TextVariant = NonNullable<TextVariantProps["variant"]>;

const ROLE: Partial<Record<TextVariant, Role>> = {
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  blockquote: Platform.select({ web: "blockquote" as Role }),
  code: Platform.select({ web: "code" as Role }),
};

const ARIA_LEVEL: Partial<Record<TextVariant, string>> = { h1: "1", h2: "2", h3: "3", h4: "4" };

const TextClassContext = React.createContext<string | undefined>(undefined);

// Every Text resolved its classes on every render: cva, then clsx and tailwind-merge over the result. A chat bubble
// draws several Texts and a timeline mounts dozens of bubbles, while the distinct (variant, context class, className)
// triples number a few hundred at most (audit nativewind-runtime-cost). Each triple is merged once and then read from
// this map; the map empties itself past MERGED_MAX, so a stream of one-off classes cannot grow it.
const MERGED_MAX = 1000;
const merged = new Map<string, string>();

/** The merged className of a Text: computed once per distinct triple. */
export function textClassName(variant: TextVariant, textClass: string | undefined, className: string | undefined): string {
  const key = `${variant}\u0000${textClass ?? ""}\u0000${className ?? ""}`;
  const hit = merged.get(key);
  if (hit !== undefined) return hit;
  const value = cn(textVariants({ variant }), textClass, className);
  if (merged.size >= MERGED_MAX) merged.clear();
  merged.set(key, value);
  return value;
}

function Text({
  className,
  asChild = false,
  variant = "default",
  ...props
}: React.ComponentProps<typeof RNText> & React.RefAttributes<typeof RNText> & TextVariantProps & { asChild?: boolean }) {
  const textClass = React.use(TextClassContext);
  const Component = asChild ? Slot : RNText;
  return (
    <Component
      className={textClassName(variant ?? "default", textClass, className)}
      role={variant ? ROLE[variant] : undefined}
      aria-level={variant ? ARIA_LEVEL[variant] : undefined}
      {...props}
    />
  );
}

export { Text, TextClassContext };

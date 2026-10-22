// Ported from usf apps/mobile/components/ui/button.tsx (React Native Reusables).
// Sized for touch (audit UX P2): every size reaches 44 pt on iOS and 48 dp on
// Android, the small one through hit slop so it keeps its look; Android
// answers a press with a ripple (components/ui/ripple.ts).
import { cva, type VariantProps } from "class-variance-authority";
import { Platform, Pressable } from "react-native";
import { useRipple } from "@/components/ui/ripple";
import { TextClassContext } from "@/components/ui/text";
import { hitSlopFor } from "@/lib/platform-ui";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  cn(
    "group shrink-0 flex-row items-center justify-center gap-2 rounded-md shadow-none",
    Platform.select({
      web: cn(
        "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        "whitespace-nowrap outline-none transition-all disabled:pointer-events-none",
        "[&_svg:not([class*='size-'])]:size-4 [&_svg]:pointer-events-none [&_svg]:shrink-0",
      ),
    }),
  ),
  {
    variants: {
      variant: {
        default: cn("bg-primary active:bg-primary/90 shadow-sm shadow-black/5", Platform.select({ web: "hover:bg-primary/90" })),
        destructive: cn(
          "bg-destructive active:bg-destructive/90 dark:bg-destructive/60 shadow-sm shadow-black/5",
          Platform.select({ web: "hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40" }),
        ),
        outline: cn(
          "border-border bg-background active:bg-accent dark:bg-input/30 dark:border-input dark:active:bg-input/50 border shadow-sm shadow-black/5",
          Platform.select({ web: "hover:bg-accent dark:hover:bg-input/50" }),
        ),
        secondary: cn("bg-secondary active:bg-secondary/80 shadow-sm shadow-black/5", Platform.select({ web: "hover:bg-secondary/80" })),
        ghost: cn("active:bg-accent dark:active:bg-accent/50", Platform.select({ web: "hover:bg-accent dark:hover:bg-accent/50" })),
        link: "",
      },
      size: {
        default: cn("min-h-11 px-4 py-2", Platform.select({ web: "has-[>svg]:px-3" })),
        sm: cn("min-h-9 gap-1.5 rounded-md px-3 py-1.5", Platform.select({ web: "has-[>svg]:px-2.5" })),
        lg: cn("min-h-12 rounded-md px-6 py-2", Platform.select({ web: "has-[>svg]:px-4" })),
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

const buttonTextVariants = cva(cn("text-foreground text-callout font-medium", Platform.select({ web: "pointer-events-none transition-colors" })), {
  variants: {
    variant: {
      default: "text-primary-foreground",
      destructive: "text-white",
      outline: cn("group-active:text-accent-foreground", Platform.select({ web: "group-hover:text-accent-foreground" })),
      secondary: "text-secondary-foreground",
      ghost: "group-active:text-accent-foreground",
      link: cn("text-primary group-active:underline", Platform.select({ web: "underline-offset-4 hover:underline group-hover:underline" })),
    },
    size: { default: "", sm: "", lg: "", icon: "" },
  },
  defaultVariants: { variant: "default", size: "default" },
});

type ButtonProps = React.ComponentProps<typeof Pressable> & React.RefAttributes<typeof Pressable> & VariantProps<typeof buttonVariants>;

/** How tall each size is drawn at least, in points: the hit slop makes up the rest of the platform's target. */
const DRAWN: Record<NonNullable<ButtonProps["size"]>, number> = { default: 44, sm: 36, lg: 48, icon: 44 };

function Button({ className, variant, size, ...props }: ButtonProps) {
  const ripple = useRipple(size === "icon");
  return (
    <TextClassContext.Provider value={buttonTextVariants({ variant, size })}>
      <Pressable
        className={cn(props.disabled && "opacity-50", buttonVariants({ variant, size }), className)}
        role="button"
        hitSlop={hitSlopFor(DRAWN[size ?? "default"], Platform.OS)}
        android_ripple={ripple}
        {...props}
      />
    </TextClassContext.Provider>
  );
}

export { Button };

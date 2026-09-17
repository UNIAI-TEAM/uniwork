"use client";
import { ArrowRight, Loader2 } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { Button } from "@uniwork/ui/components/ui/button";
import { cn } from "@uniwork/ui/lib/utils";

/**
 * The control ruler of the signed-out flow. Login, register, forgot, reset,
 * verify and MFA share one shell, so they share one input height and one button
 * shape: when these lived in each screen, login drifted to a 48px pill while
 * the screen one click away kept a 40px rectangle.
 */
export const AUTH_INPUT = "h-11 rounded-xl text-body pointer-coarse:h-11";

/**
 * Full-width pill. The press scales the whole control on the product's own
 * motion tokens; full opacity while pending, because at the primitive's 50% a
 * busy label measured ~2:1 for exactly the seconds a slow connection stares
 * at it. The spinner and the label change say "busy"; the cursor agrees.
 */
export const AUTH_PILL =
  "h-12 w-full rounded-full text-body-lg transition-transform duration-(--duration-standard) ease-out-quart active:scale-[0.98] aria-disabled:cursor-progress aria-disabled:opacity-100 motion-reduce:transition-none pointer-coarse:h-12";

/**
 * The primary action of a credential screen: label on the left, the arrow
 * seated in its own disc flush with the right padding. The disc nudges on
 * hover; the spinner takes its place while the request runs.
 */
export function AuthSubmit({
  pending,
  pendingLabel,
  children,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, "children"> & {
  pending: boolean;
  pendingLabel: string;
  children: ReactNode;
}) {
  return (
    <Button
      type="submit"
      size="lg"
      {...props}
      className={cn(AUTH_PILL, "group/submit justify-between pl-6 pr-1.5", className)}
      aria-disabled={pending || props["aria-disabled"] || undefined}
    >
      <span>{pending ? pendingLabel : children}</span>
      <span
        aria-hidden
        className="flex size-9 items-center justify-center rounded-full bg-primary-foreground text-primary transition-transform duration-(--duration-standard) ease-out-quart group-hover/submit:translate-x-0.5 motion-reduce:transition-none"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" strokeWidth={1.75} />
        ) : (
          <ArrowRight className="size-4" strokeWidth={1.75} />
        )}
      </span>
    </Button>
  );
}

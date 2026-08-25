import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-[var(--uw-radius)] font-medium transition-colors disabled:opacity-50 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand",
  {
    variants: {
      variant: {
        primary: "bg-brand text-on-brand hover:opacity-90",
        secondary: "bg-surface text-primary border border-line hover:bg-subtle",
        outline: "bg-surface text-primary border border-line hover:bg-subtle hover:border-line-strong",
        ghost: "text-secondary hover:bg-subtle hover:text-primary",
        danger: "bg-danger text-on-brand hover:opacity-90",
      },
      size: {
        sm: "h-7 px-2.5 text-[13px]",
        md: "h-8 px-3 text-sm",
        lg: "h-10 px-4 text-body [&_svg]:size-4",
        "icon-sm": "size-7 p-0 [&_svg]:size-4",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}

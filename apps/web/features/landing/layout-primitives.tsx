import { cn } from "@uniwork/ui/lib/utils";

/** The one horizontal rhythm every landing section shares. */
export function Container({
  className,
  children,
  ref,
}: {
  className?: string;
  children: React.ReactNode;
  /** Animation scopes attach here rather than wrapping the container in a div. */
  ref?: React.Ref<HTMLDivElement>;
}) {
  return (
    <div ref={ref} className={cn("mx-auto w-full max-w-7xl px-4 sm:px-6", className)}>
      {children}
    </div>
  );
}

/** Section heading. `font-heading` is the display face; see tokens.css. */
export function SectionTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <h2 className={cn("mt-3 font-heading text-display font-bold sm:text-hero-sm", className)}>{children}</h2>
  );
}

export function Eyebrow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-label font-semibold", className)}>{children}</p>;
}

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

/**
 * A section whose polarity is flipped against the page.
 *
 * The background is painted here and the CONTENT is wrapped in `.dark`, which
 * is not a stylistic choice: custom properties are computed and then
 * inherited, so `.dark` on this same element would resolve
 * --surface-emphasis to its own dark value and the band would look identical
 * in both themes. Split across two elements, the ground tracks the page theme
 * while the text, brand hue and focus ring come from the dark palette — which
 * is what keeps the eyebrow above 4.5:1 (packages/ui/styles/tokens.test.ts).
 *
 * Do not put a load-bearing border inside: --border sits at 1.04 against the
 * dark-page band. Separate with radius and elevation instead.
 */
export function EmphasisSection({
  id,
  className,
  children,
}: {
  id?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={cn("bg-surface-emphasis", className)}>
      <div className="dark text-foreground">{children}</div>
    </section>
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

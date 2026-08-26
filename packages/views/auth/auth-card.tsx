import { Logo } from "@uniwork/ui/brand";

/**
 * The shell both credential screens share. The lockup sits outside the card so
 * the card stays a single form and the brand is the first thing read on the
 * page - these two screens are the only place in the app a signed-out person
 * sees, so they are where the product names itself.
 *
 * `<main>` because these two routes render no other landmark: without it a
 * screen reader's landmark list is empty and there is nothing to skip to.
 */
export function AuthCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 bg-background p-4">
      <Logo variant="lockup" size={30} />
      <div className="w-full max-w-sm rounded-lg border border-border bg-surface p-6">
        <h1 className="mb-4 text-title font-semibold text-foreground">{title}</h1>
        {children}
      </div>
    </main>
  );
}

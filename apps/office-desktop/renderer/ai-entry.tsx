import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Sparkles } from "lucide-react";
import { Button, buttonVariants } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@uniwork/ui/components/ui/popover";
import { cn } from "@uniwork/ui/lib/utils";

/** The editor's AI entry while the document is local/not account-bound. It is
 * deliberately inert: opening the prompt never calls a model, never sends
 * document content, and signed out it only offers the sign-in flow. */
export function LockedAiEntry({ signedIn, onSignIn }: { signedIn: boolean; onSignIn?: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.ai" });
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "desktop-ai-entry whitespace-nowrap")} aria-label={t("entry")} title={t("entry")} data-ai-entry="locked">
        <Sparkles className="size-4 shrink-0" aria-hidden /><span>{t("entry")}</span>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverTitle>{t("title")}</PopoverTitle>
        <p className="py-2 text-body text-muted-foreground">{t(signedIn ? "localDescription" : "signedOutDescription")}</p>
        {!signedIn && onSignIn ? <Button type="button" className="w-full" onClick={() => { setOpen(false); onSignIn(); }}>{t("signIn")}</Button> : null}
        <Button type="button" variant="outline" className="mt-2 w-full" onClick={() => setOpen(false)}>{t("close")}</Button>
      </PopoverContent>
    </Popover>
  );
}

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@uniwork/ui/components/ui/button";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@uniwork/ui/components/ui/popover";

function SparkIcon() {
  return <svg className="size-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /><circle cx="12" cy="12" r="3.2" /></svg>;
}

/** The editor's AI entry while the document is local/not account-bound. It is
 * deliberately inert: opening the prompt never calls a model, never sends
 * document content, and signed out it only offers the sign-in flow. */
export function LockedAiEntry({ signedIn, onSignIn }: { signedIn: boolean; onSignIn?: () => void }) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.ai" });
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className="desktop-ai-entry" aria-label={t("entry")} title={t("entry")} data-ai-entry="locked">
        <SparkIcon /><span>{t("entry")}</span>
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

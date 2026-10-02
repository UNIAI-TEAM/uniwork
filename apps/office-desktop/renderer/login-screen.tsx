import { useTranslation } from "react-i18next";
import { Logo } from "@uniwork/ui/brand";
import { Button } from "@uniwork/ui/components/ui/button";
import type { LoginScreenState } from "./login";

export interface LoginScreenProps {
  state: LoginScreenState;
  onStart: () => void;
  onCancel: () => void;
  /** Open a .docx from disk without signing in. */
  onOpenLocal?: () => void;
  /** Enter the local home without signing in. */
  onUseLocal?: () => void;
}

const MESSAGE_KEY: Record<LoginScreenState, string> = {
  "signed-out": "signedOut",
  pending: "pending",
  error: "error",
  cancelled: "cancelled",
  "signed-in": "signedOut",
  locked: "locked",
  "login-required": "required",
  expired: "expired",
};

/** The centred sign-in card shown before a workspace is reached. The desktop
 * host never asks for a password here: the only action opens the system
 * browser, where the real credential form lives. Two secondary actions enter
 * the local device mode without any account. */
export function LoginScreen({ state, onStart, onCancel, onOpenLocal, onUseLocal }: LoginScreenProps) {
  const { t } = useTranslation(undefined, { keyPrefix: "officeDesktop.login" });
  const pending = state === "pending";
  return (
    <div className="flex h-full min-h-0 items-center justify-center bg-background p-6" data-login-state={state}>
      <div className="flex w-full max-w-sm flex-col items-center gap-6 rounded-xl border border-border bg-surface p-8 text-center shadow-sm">
        <Logo variant="lockup" size={28} />
        <div className="flex flex-col gap-2">
          <h1 className="text-title font-semibold text-foreground">{t("title")}</h1>
          <p className="text-body text-muted-foreground">{t(MESSAGE_KEY[state])}</p>
        </div>
        {pending ? (
          <Button variant="outline" className="w-full" onClick={onCancel}>
            {t("cancel")}
          </Button>
        ) : (
          <Button className="w-full" onClick={onStart} disabled={state === "signed-in"}>
            {t("start")}
          </Button>
        )}
        {!pending && (onOpenLocal || onUseLocal) ? (
          <div className="flex w-full flex-col gap-2">
            {onOpenLocal ? <Button variant="outline" className="w-full" onClick={onOpenLocal}>{t("openLocal")}</Button> : null}
            {onUseLocal ? <Button variant="outline" className="w-full" onClick={onUseLocal}>{t("useLocal")}</Button> : null}
            <p className="text-caption text-muted-foreground">{t("localNote")}</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

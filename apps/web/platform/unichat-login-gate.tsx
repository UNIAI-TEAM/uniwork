"use client";

import { Check, Globe, MessagesSquare, Sparkles, Video, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { getDesktopBridge } from "@uniwork/core/platform";
import { UniChatIcon } from "@uniwork/ui/brand/unichat-icon";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";

/** The gate's one action: a 320px, 44px pill. */
const PILL = "h-11 w-80 max-w-full rounded-full text-body font-semibold";

type Phase = "idle" | "opening" | "waiting" | "failed";

/** What UniChat is for, in three lines under the welcome (canvas "Màn chào"). */
const FEATURES: { key: string; icon: LucideIcon; tone: IconTileTone }[] = [
  { key: "unichat_login_feature_chats", icon: MessagesSquare, tone: "blue" },
  { key: "unichat_login_feature_calls", icon: Video, tone: "teal" },
  { key: "unichat_login_feature_uni", icon: Sparkles, tone: "violet" },
];

/**
 * `/login` inside the UniChat shell, shaped like a messenger's first screen
 * (Telegram, Viber, WhatsApp desktop): the mark, one line, what it does, one
 * button. The web form signs in by cookie, which the shell's main-process
 * session never sees, so the button starts the shell's PKCE login in the
 * system browser instead, and the gate then walks through what happens there.
 * Nothing opens until the person asks: a browser popping up at launch or right
 * after a sign-out reads as a bug.
 */
export function UniChatLoginGate() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const version = getDesktopBridge()?.appInfo?.version;
  // The shell refuses deliberately (no keyring, /auth/desktop/start down, browser
  // would not open); the rejection is the only signal, so it becomes one line.
  // A second press while the browser is open re-opens the same sign-in page.
  const login = () => {
    setPhase("opening");
    getDesktopBridge()
      ?.session.login()
      .then(
        () => setPhase("waiting"),
        () => setPhase("failed"),
      );
  };
  const waiting = phase === "waiting";
  return (
    // The chat wall (packages/views/chat/chat-wall.ts), so signing in already looks like the app.
    <main
      data-window-drag
      className="flex min-h-dvh flex-col bg-chat-wall bg-[radial-gradient(var(--chat-wall-dot)_1.2px,transparent_1.4px)] bg-size-[22px_22px]"
    >
      <div className="flex flex-1 items-center justify-center px-6 py-8">
        <div className="flex w-full max-w-105 flex-col items-center rounded-3xl bg-surface px-10 pt-10 pb-8 text-center shadow-floating">
          <UniChatIcon size={96} decorative />
          <h1 className="mt-7 font-display text-display-sm leading-8 font-extrabold tracking-[-0.01em] text-foreground">
            {t("auth.desktop.unichat_login_title")}
          </h1>
          <p className="mt-2 max-w-95 text-body-lg text-muted-foreground">{t("auth.desktop.unichat_login_hint")}</p>
          {waiting ? (
            <>
              <p role="status" className="mt-7 flex items-center gap-2.5 text-body font-medium text-foreground">
                <Spinner className="size-4.5 text-brand" />
                {t("auth.desktop.unichat_login_waiting")}
              </p>
              {/* What happens in the browser, step by step: the first is done, the second is the reader's. */}
              <ol className="mt-4 flex w-full flex-col gap-3 rounded-2xl bg-muted p-4 text-left text-body">
                <LoginStep index={1} state="done">
                  {t("auth.desktop.unichat_login_step_opened")}
                </LoginStep>
                <LoginStep index={2} state="now">
                  {t("auth.desktop.unichat_login_step_allow")}
                </LoginStep>
                <LoginStep index={3} state="next">
                  {t("auth.desktop.unichat_login_step_return")}
                </LoginStep>
              </ol>
              <Button type="button" variant="secondary" className={cn(PILL, "mt-5")} onClick={login}>
                <Globe aria-hidden className="size-4" />
                {t("auth.desktop.unichat_login_reopen")}
              </Button>
              <Button type="button" variant="ghost" className="mt-1.5 h-11 rounded-full px-5 text-body text-muted-foreground" onClick={() => setPhase("idle")}>
                {t("auth.desktop.unichat_login_cancel")}
              </Button>
            </>
          ) : (
            <>
              <ul className="mt-7 flex w-full flex-col gap-3.5 text-left">
                {FEATURES.map((feature) => (
                  <li key={feature.key} className="flex items-center gap-3.5 text-body text-foreground">
                    <IconTile icon={feature.icon} tone={feature.tone} className="shrink-0" />
                    {t(`auth.desktop.${feature.key}`)}
                  </li>
                ))}
              </ul>
              <Button type="button" className={cn(PILL, "mt-8")} aria-disabled={phase === "opening"} onClick={login}>
                {phase === "opening" ? <Spinner data-icon="inline-start" /> : null}
                {t("auth.desktop.unichat_login_button")}
              </Button>
            </>
          )}
          {phase === "failed" ? (
            <p role="alert" className="mt-3 text-body text-destructive">
              {t("auth.desktop.unichat_login_failed")}
            </p>
          ) : null}
        </div>
      </div>
      {version ? (
        <p className="pb-4 text-center text-caption text-muted-foreground">
          {t("auth.desktop.unichat_login_version", { version })}
        </p>
      ) : null}
    </main>
  );
}

function LoginStep({ index, state, children }: { index: number; state: "done" | "now" | "next"; children: string }) {
  return (
    <li className={cn("flex items-start gap-3", state === "next" && "text-muted-foreground")}>
      <span
        aria-hidden
        className={cn(
          "mt-px flex size-6 shrink-0 items-center justify-center rounded-full text-caption font-bold",
          state === "done" && "bg-success-soft text-success-soft-foreground",
          state === "now" && "bg-primary text-primary-foreground",
          state === "next" && "bg-border text-foreground",
        )}
      >
        {state === "done" ? <Check className="size-3.5" /> : index}
      </span>
      {children}
    </li>
  );
}

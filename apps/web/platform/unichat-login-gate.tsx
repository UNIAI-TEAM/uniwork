"use client";

import { Check, Globe, MessagesSquare, Sparkles, Video, type LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { SignInProvider } from "@uniwork/core/api/endpoints/sign-in-schemas";
import { useAuthProviders } from "@uniwork/core/auth";
import { providerNameKey } from "@uniwork/core/auth/sign-in-errors";
import { getDesktopBridge } from "@uniwork/core/platform";
import { UniChatIcon } from "@uniwork/ui/brand/unichat-icon";
import { IconTile, type IconTileTone } from "@uniwork/ui/components/common/icon-tile";
import { Button } from "@uniwork/ui/components/ui/button";
import { Separator } from "@uniwork/ui/components/ui/separator";
import { Spinner } from "@uniwork/ui/components/ui/spinner";
import { cn } from "@uniwork/ui/lib/utils";
import { ProviderPillFace, providerPillClass, webSignInProviders } from "@uniwork/views/auth/social-sign-in";

/** The gate's actions: 320px, 44px pills. */
const PILL = "h-11 w-80 max-w-full rounded-full text-body font-semibold";

/** The pressed pill keeps full strength while the browser opens; its spinner says busy, the others dim. */
const PRESSED = "aria-disabled:cursor-progress aria-disabled:opacity-100";

/** A provider, or the UniWork sign-in page, where the email and password form is. */
type Way = SignInProvider | "email";

type Phase = "idle" | "opening" | "waiting" | "reopening" | "failed";

/** What UniChat is for, in three lines under the welcome (canvas "Màn chào"). */
const FEATURES: { key: string; icon: LucideIcon; tone: IconTileTone }[] = [
  { key: "unichat_login_feature_chats", icon: MessagesSquare, tone: "blue" },
  { key: "unichat_login_feature_calls", icon: Video, tone: "teal" },
  { key: "unichat_login_feature_uni", icon: Sparkles, tone: "violet" },
];

/**
 * `/login` inside the UniChat shell, shaped like a messenger's first screen
 * (Telegram, Viber, WhatsApp desktop): the mark, one line, what it does, then
 * the ways in. The web form signs in by cookie, which the shell's
 * main-process session never sees, so every button starts the shell's PKCE
 * login in the system browser instead, and the gate then walks through what
 * happens there. Nothing opens until the person asks: a browser popping up at
 * launch or right after a sign-out reads as a bug.
 *
 * The ways in stand as they do on the web's /login and on the phone (spec
 * §4.1): Google and Apple first, each sending the browser straight to that
 * provider (the start route's hint, spec §3.5), then email, which opens the
 * UniWork sign-in page. A shell built before the hint opens that page for
 * every button, which is one press longer, never broken.
 */
export function UniChatLoginGate() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  // The way the last press chose: its pill spins, and the waiting steps and
  // "Mở lại trình duyệt" follow it.
  const [way, setWay] = useState<Way>("email");
  const providers = useAuthProviders();
  const offered = webSignInProviders(providers.data);
  const version = getDesktopBridge()?.appInfo?.version;
  // Only the latest press may move the phase: "Hủy" while the browser
  // re-opens must not be undone by that press landing a moment later.
  const press = useRef(0);
  const pills = useRef(new Map<Way, HTMLButtonElement>());
  const reopen = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef(false);

  // The shell refuses deliberately (no keyring, /auth/desktop/start down, browser
  // would not open); the rejection is the only signal, so it becomes one line.
  // Pressing the same way again while the browser is open re-opens the same
  // page; another way is a new sign-in (ShellSession.login).
  const login = (chosen: Way, busy: "opening" | "reopening" = "opening") => {
    const mine = ++press.current;
    setWay(chosen);
    setPhase(busy);
    getDesktopBridge()
      ?.session.login(chosen === "email" ? undefined : { provider: chosen })
      .then(
        () => mine === press.current && setPhase("waiting"),
        () => mine === press.current && setPhase("failed"),
      );
  };
  const cancel = () => {
    press.current++;
    returnFocus.current = true;
    setPhase("idle");
  };

  // The pressed pill leaves the screen with the steps, and comes back with
  // "Hủy" or with a re-open the shell refused: focus goes where the person's
  // next press is, never to the page behind a button that just unmounted.
  useEffect(() => {
    if (phase === "waiting") reopen.current?.focus();
    if ((phase === "idle" && returnFocus.current) || phase === "failed") {
      returnFocus.current = false;
      pills.current.get(way)?.focus();
    }
  }, [phase, way]);

  const waiting = phase === "waiting" || phase === "reopening";
  const opening = phase === "opening";
  const pill = (target: Way) => (el: HTMLButtonElement | null) => {
    if (el) pills.current.set(target, el);
    else pills.current.delete(target);
  };
  return (
    // The chat wall (packages/views/chat/chat-wall.ts), so signing in already looks like the app.
    <main
      data-window-drag
      className="flex min-h-dvh flex-col bg-chat-wall bg-[radial-gradient(var(--chat-wall-dot)_1.2px,transparent_1.4px)] bg-size-[22px_22px]"
    >
      {/* The whole welcome stands about 750px tall and the shell's window can be
          600px: below 760px the feature list goes and the mark shrinks, so every
          way in stays on screen without scrolling a page that is all drag region. */}
      <div className="flex flex-1 items-center justify-center px-6 py-8 [@media(max-height:47.5rem)]:py-4">
        <div className="flex w-full max-w-105 flex-col items-center rounded-3xl bg-surface px-10 pt-10 pb-8 text-center shadow-floating">
          <UniChatIcon size={96} decorative className="[@media(max-height:47.5rem)]:size-18" />
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
                  {way === "email"
                    ? t("auth.desktop.unichat_login_step_opened")
                    : t("auth.social.browserOpened", { provider: t(providerNameKey(way)) })}
                </LoginStep>
                <LoginStep index={2} state="now">
                  {t("auth.desktop.unichat_login_step_allow")}
                </LoginStep>
                <LoginStep index={3} state="next">
                  {t("auth.desktop.unichat_login_step_return")}
                </LoginStep>
              </ol>
              <Button
                ref={reopen}
                type="button"
                variant="secondary"
                className={cn(PILL, PRESSED, "mt-5")}
                aria-disabled={phase === "reopening"}
                onClick={() => login(way, "reopening")}
              >
                {phase === "reopening" ? <Spinner className="size-4" /> : <Globe aria-hidden className="size-4" />}
                {t("auth.desktop.unichat_login_reopen")}
              </Button>
              <Button type="button" variant="ghost" className="mt-1.5 h-11 rounded-full px-5 text-body text-muted-foreground" onClick={cancel}>
                {t("auth.desktop.unichat_login_cancel")}
              </Button>
            </>
          ) : (
            <>
              <ul className="mt-7 flex w-full flex-col gap-3.5 text-left [@media(max-height:47.5rem)]:hidden">
                {FEATURES.map((feature) => (
                  <li key={feature.key} className="flex items-center gap-3.5 text-body text-foreground">
                    <IconTile icon={feature.icon} tone={feature.tone} className="shrink-0" />
                    {t(`auth.desktop.${feature.key}`)}
                  </li>
                ))}
              </ul>
              <div className="mt-8 flex w-full flex-col items-center gap-3 [@media(max-height:47.5rem)]:mt-7">
                {providers.isPending ? (
                  // Held, invisibly, for two pills and the divider, as on the web's
                  // /login: the email pill must not move under a pointer on its way.
                  <div aria-hidden data-slot="social-placeholder" className="invisible flex flex-col gap-3">
                    <div className="h-11" />
                    <div className="h-11" />
                    <div className="h-4" />
                  </div>
                ) : offered.length > 0 ? (
                  <>
                    <div role="group" aria-label={t("auth.social.groupLabel")} className="flex w-full flex-col items-center gap-3">
                      {offered.map((provider) => (
                        <Button
                          key={provider}
                          ref={pill(provider)}
                          type="button"
                          variant="outline"
                          className={cn(PILL, "gap-2.5", providerPillClass(provider), way === provider && PRESSED)}
                          aria-disabled={opening}
                          onClick={() => login(provider)}
                        >
                          <ProviderPillFace provider={provider} busy={opening && way === provider} />
                        </Button>
                      ))}
                    </div>
                    <div className="flex h-4 w-80 max-w-full items-center gap-3 text-caption text-muted-foreground">
                      <Separator className="flex-1" />
                      <span>{t("auth.social.or")}</span>
                      <Separator className="flex-1" />
                    </div>
                  </>
                ) : null}
                <Button
                  ref={pill("email")}
                  type="button"
                  className={cn(PILL, way === "email" && PRESSED)}
                  aria-disabled={opening}
                  onClick={() => login("email")}
                >
                  {opening && way === "email" ? <Spinner data-icon="inline-start" /> : null}
                  {t("auth.social.continueWithEmail")}
                </Button>
              </div>
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
